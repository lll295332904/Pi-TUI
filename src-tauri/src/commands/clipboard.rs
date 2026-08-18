use crate::error::{AppError, AppResult};

/// Directory where pasted images are persisted before being sent to Pi.
fn pasted_images_dir() -> std::path::PathBuf {
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".into());
    std::path::PathBuf::from(&home).join(".pi").join("agent").join("pasted-images")
}

/// Save an image pasted from the clipboard as a file so it can flow through the
/// existing path-based image pipeline (composer -> prompt -> Pi).
///
/// `data_base64` is the raw image bytes (png/jpeg/webp/...) base64-encoded by the
/// frontend; `ext` is the file extension derived from the MIME type.
#[tauri::command]
pub async fn save_pasted_image(data_base64: String, ext: String) -> AppResult<String> {
    use base64::Engine as _;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.trim())
        .map_err(|e| AppError::Internal { detail: format!("Invalid pasted image data: {e}") })?;

    if bytes.is_empty() {
        return Err(AppError::Internal { detail: "Pasted image data is empty".into() }.into());
    }

    let safe_ext = sanitize_ext(&ext);
    let path = next_paste_path(&safe_ext)?;
    std::fs::write(&path, &bytes)
        .map_err(|e| AppError::Internal { detail: format!("Cannot write pasted image: {e}") })?;

    Ok(path.to_string_lossy().to_string())
}

/// Fallback path: the Tauri clipboard plugin returns raw RGBA pixels, so encode
/// them as a PNG file on the Rust side.
#[tauri::command]
pub async fn save_pasted_rgba(rgba: Vec<u8>, width: u32, height: u32) -> AppResult<String> {
    let expected = (width as usize)
        .checked_mul(height as usize)
        .and_then(|n| n.checked_mul(4))
        .unwrap_or(0);
    if expected == 0 || rgba.len() != expected {
        return Err(AppError::Internal {
            detail: format!("Invalid clipboard image dimensions: {width}x{height}, {} bytes", rgba.len()),
        }
        .into());
    }

    let path = next_paste_path("png")?;
    let file = std::fs::File::create(&path)
        .map_err(|e| AppError::Internal { detail: format!("Cannot create pasted image: {e}") })?;
    let mut encoder = png::Encoder::new(file, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder
        .write_header()
        .map_err(|e| AppError::Internal { detail: format!("PNG header failed: {e}") })?;
    writer
        .write_image_data(&rgba)
        .map_err(|e| AppError::Internal { detail: format!("PNG encode failed: {e}") })?;
    writer
        .finish()
        .map_err(|e| AppError::Internal { detail: format!("PNG finish failed: {e}") })?;

    Ok(path.to_string_lossy().to_string())
}

fn sanitize_ext(ext: &str) -> String {
    let cleaned = ext
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase();
    if cleaned.is_empty() { "png".to_string() } else { cleaned }
}

fn next_paste_path(ext: &str) -> AppResult<std::path::PathBuf> {
    let dir = pasted_images_dir();
    std::fs::create_dir_all(&dir).map_err(|e| AppError::UserDataNotAccessible {
        detail: format!("Cannot create pasted-images dir: {e}"),
    })?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    Ok(dir.join(format!("pasted-{ts}.{ext}")))
}
