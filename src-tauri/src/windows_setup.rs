//! Windows first-run repair for per-user application settings.
//!
//! PiDesk deliberately uses HKCU rather than HKLM so setup does not require
//! elevation or an administrator account. Registry failures are diagnostic
//! only; the app can still run with file-based configuration.

#[cfg(windows)]
use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, REG_SZ,
};

#[cfg(windows)]
const APP_KEY: &str = "Software\\PiDesk";

/// Create or repair the per-user PiDesk registry key.
///
/// This is intentionally best-effort. A locked-down environment may deny
/// registry writes, but that must not prevent the main application from
/// starting because all functional settings are also file-backed.
pub fn ensure_user_registry() -> Result<(), String> {
    #[cfg(windows)]
    {
        ensure_user_registry_windows()
    }

    #[cfg(not(windows))]
    {
        Ok(())
    }
}

#[cfg(windows)]
fn ensure_user_registry_windows() -> Result<(), String> {
    let key_name: Vec<u16> = APP_KEY.encode_utf16().chain(std::iter::once(0)).collect();
    let value_name: Vec<u16> = "InstallVersion".encode_utf16().chain(std::iter::once(0)).collect();
    let value: Vec<u16> = env!("CARGO_PKG_VERSION")
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let mut key: HKEY = std::ptr::null_mut();
    let status = unsafe { RegCreateKeyW(HKEY_CURRENT_USER, key_name.as_ptr(), &mut key) };
    if status != 0 {
        return Err(format!("RegCreateKeyExW failed with code {}", status));
    }

    let value_bytes = value.len() * std::mem::size_of::<u16>();
    let set_status = unsafe {
        RegSetValueExW(
            key,
            value_name.as_ptr(),
            0,
            REG_SZ,
            value.as_ptr() as *const u8,
            value_bytes as u32,
        )
    };
    unsafe { RegCloseKey(key); }

    if set_status != 0 {
        return Err(format!("RegSetValueExW failed with code {}", set_status));
    }

    Ok(())
}
