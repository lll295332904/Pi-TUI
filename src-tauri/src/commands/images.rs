//! Image attachment helpers.
//!
//! Pi's RPC protocol expects inline image attachments as content parts:
//! `{ "type": "image", "mimeType": "...", "data": "<base64>" }`. The frontend
//! only knows file paths, so we read + encode the files here (Rust side),
//! converting formats the providers reject (e.g. BMP) into PNG along the way.

use crate::error::{AppError, AppResult};
use crate::pi_kernel::ImageContent;
use base64::Engine as _;

/// Read a file and detect its MIME type from magic bytes (extension as fallback).
pub fn detect_mime(bytes: &[u8]) -> &'static str {
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if bytes.len() >= 8 && bytes[0] == 0x89 && bytes[1] == b'P' && bytes[2] == b'N' && bytes[3] == b'G' {
        return "image/png";
    }
    // JPEG: FF D8 FF
    if bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
        return "image/jpeg";
    }
    // GIF: "GIF8"
    if bytes.len() >= 4 && &bytes[0..4] == b"GIF8" {
        return "image/gif";
    }
    // WebP: "RIFF" .... "WEBP"
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return "image/webp";
    }
    // BMP: "BM"
    if bytes.len() >= 2 && &bytes[0..2] == b"BM" {
        return "image/bmp";
    }
    "application/octet-stream"
}

/// Normalize image bytes to a MIME type + base64 payload that Pi / the model
/// providers accept. BMP is decoded and re-encoded as PNG (providers only
/// support png/jpeg/gif/webp). Everything else is passed through as-is.
pub fn encode_image(bytes: &[u8]) -> AppResult<(String, String)> {
    let mime = detect_mime(bytes);
    let data = match mime {
        "image/bmp" => bmp_to_png_base64(bytes)?,
        _other => base64::engine::general_purpose::STANDARD.encode(bytes),
    };
    let normalized_mime = if mime == "image/bmp" { "image/png" } else { mime };
    Ok((normalized_mime.to_string(), data))
}

/// Convert a list of image file paths into Pi `ImageContent` parts.
/// Non-image / unreadable files are skipped with a logged warning so one bad
/// attachment cannot stall the whole prompt.
pub fn load_image_parts(paths: Vec<String>) -> AppResult<Vec<ImageContent>> {
    let mut parts = Vec::with_capacity(paths.len());
    for path in paths {
        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(e) => {
                eprintln!("[pidesk] skip unreadable image attachment {}: {}", path, e);
                continue;
            }
        };
        if bytes.is_empty() {
            eprintln!("[pidesk] skip empty image attachment {}", path);
            continue;
        }
        match encode_image(&bytes) {
            Ok((mime, data)) => parts.push(ImageContent::new(&mime, data)),
            Err(e) => eprintln!("[pidesk] skip invalid image attachment {}: {:?}", path, e),
        }
    }
    Ok(parts)
}

/// Tauri command: return a `data:` URL for a local image so the renderer can
/// display it in the conversation without enabling the asset protocol.
#[tauri::command]
pub async fn image_to_data_url(path: String) -> AppResult<String> {
    let bytes = std::fs::read(&path)
        .map_err(|e| AppError::Internal { detail: format!("Cannot read image {}: {}", path, e) })?;
    if bytes.is_empty() {
        return Err(AppError::Internal { detail: format!("Image file is empty: {}", path) }.into());
    }
    let (mime, data) = encode_image(&bytes)?;
    Ok(format!("data:{};base64,{}", mime, data))
}

// ── BMP → PNG (24/32-bit uncompressed) ──
//
// Clipboard/attached BMPs in the wild are almost always BI_RGB with 24 or 32
// bits per pixel. Anything else is rejected with a clear error.

fn bmp_to_png_base64(bytes: &[u8]) -> AppResult<String> {
    if bytes.len() < 54 {
        return Err(AppError::Internal { detail: "BMP file too short".into() }.into());
    }
    let pixel_offset = u32::from_le_bytes(bytes[10..14].try_into().unwrap()) as usize;
    let dib_size = u32::from_le_bytes(bytes[14..18].try_into().unwrap());

    // Only BITMAPINFOHEADER (40 bytes) is supported here.
    if dib_size != 40 {
        return Err(AppError::Internal { detail: format!("Unsupported BMP header (DIB size {})", dib_size) }.into());
    }
    let width_i = i32::from_le_bytes(bytes[18..22].try_into().unwrap());
    let height_i = i32::from_le_bytes(bytes[22..26].try_into().unwrap());
    let bpp = u16::from_le_bytes(bytes[28..30].try_into().unwrap());
    let compression = u32::from_le_bytes(bytes[30..34].try_into().unwrap());

    if compression != 0 {
        return Err(AppError::Internal { detail: format!("Unsupported BMP compression ({})", compression) }.into());
    }
    if bpp != 24 && bpp != 32 {
        return Err(AppError::Internal { detail: format!("Unsupported BMP bit depth ({})", bpp) }.into());
    }
    if width_i <= 0 || height_i == 0 {
        return Err(AppError::Internal { detail: "Invalid BMP dimensions".into() }.into());
    }

    let width = width_i as u32;
    // Negative height = top-down rows; positive = bottom-up.
    let top_down = height_i < 0;
    let height = height_i.unsigned_abs();

    let bytes_per_pixel = (bpp / 8) as usize;
    let row_size = ((width as usize) * bytes_per_pixel + 3) & !3;
    let row_bytes = &bytes[pixel_offset..];
    if row_bytes.len() < row_size * height as usize {
        return Err(AppError::Internal { detail: "BMP pixel data truncated".into() }.into());
    }

    let mut rgba = Vec::with_capacity((width as usize) * (height as usize) * 4);
    for row in 0..height as usize {
        // BMP rows are stored bottom-up unless the height is negative.
        let src_row = if top_down { row } else { (height as usize) - 1 - row };
        let start = src_row * row_size;
        for col in 0..width as usize {
            let i = start + col * bytes_per_pixel;
            let b = row_bytes[i];
            let g = row_bytes[i + 1];
            let r = row_bytes[i + 2];
            let a = if bpp == 32 { row_bytes[i + 3] } else { 255 };
            rgba.extend_from_slice(&[r, g, b, a]);
        }
    }

    let mut png_bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|e| AppError::Internal { detail: format!("PNG header failed: {}", e) })?;
        writer
            .write_image_data(&rgba)
            .map_err(|e| AppError::Internal { detail: format!("PNG encode failed: {}", e) })?;
    }

    Ok(base64::engine::general_purpose::STANDARD.encode(&png_bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a minimal 2x2 24-bit bottom-up BMP (BI_RGB).
    fn make_bmp_24() -> Vec<u8> {
        let width = 2u32;
        let height = 2u32;
        let row_size = ((width as usize) * 3 + 3) & !3; // 8
        let pixel_offset = 54usize;
        let file_size = (pixel_offset + row_size * height as usize) as u32;

        let mut b = Vec::new();
        b.extend_from_slice(b"BM");
        b.extend_from_slice(&file_size.to_le_bytes());
        b.extend_from_slice(&[0u8; 4]); // reserved
        b.extend_from_slice(&(pixel_offset as u32).to_le_bytes());
        b.extend_from_slice(&40u32.to_le_bytes()); // BITMAPINFOHEADER
        b.extend_from_slice(&width.to_le_bytes());
        b.extend_from_slice(&height.to_le_bytes());
        b.extend_from_slice(&1u16.to_le_bytes()); // planes
        b.extend_from_slice(&24u16.to_le_bytes()); // bpp
        b.extend_from_slice(&0u32.to_le_bytes()); // BI_RGB
        b.extend_from_slice(&0u32.to_le_bytes()); // image size (0 ok for BI_RGB)
        b.extend_from_slice(&[0u8; 16]); // resolution + colors
        // Rows bottom-up: row 0 = bottom (blue), row 1 = top (red), padded to 4 bytes
        b.extend_from_slice(&[255, 0, 0, 0, 255, 0, 0, 0]); // row 0: BGR(0,0,255) + pad… actually BGR order
        b.extend_from_slice(&[0, 255, 0, 0, 0, 0, 255, 0]); // row 1: BGR(255,0,0)
        b
    }

    #[test]
    fn detect_mime_magic_bytes() {
        let png = [0x89u8, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        assert_eq!(detect_mime(&png), "image/png");
        assert_eq!(detect_mime(&[0xFF, 0xD8, 0xFF, 0xE0]), "image/jpeg");
        assert_eq!(detect_mime(b"GIF89a"), "image/gif");
        assert_eq!(detect_mime(b"RIFF\x00\x00\x00\x00WEBP"), "image/webp");
        assert_eq!(detect_mime(b"BM\x00\x00"), "image/bmp");
        assert_eq!(detect_mime(b"hello"), "application/octet-stream");
    }

    #[test]
    fn bmp_24_converts_to_png() {
        let bmp = make_bmp_24();
        let (mime, data) = encode_image(&bmp).expect("encode should succeed");
        assert_eq!(mime, "image/png");
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&data)
            .expect("base64 decode");
        // PNG signature + IHDR implies a valid PNG stream.
        assert_eq!(&decoded[0..8], &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
        assert!(decoded.windows(4).any(|w| w == b"IHDR"));
    }

    #[test]
    fn png_passthrough_keeps_mime() {
        let png = [0x89u8, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3];
        let (mime, data) = encode_image(&png).expect("encode should succeed");
        assert_eq!(mime, "image/png");
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&data)
            .expect("base64 decode");
        assert_eq!(decoded.as_slice(), &png);
    }
}
