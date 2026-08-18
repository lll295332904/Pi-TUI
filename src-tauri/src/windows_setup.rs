//! Windows first-run repair for per-user application settings.
//!
//! PiDesk deliberately uses HKCU rather than HKLM so setup does not require
//! elevation or an administrator account. Registry failures are diagnostic
//! only; the app can still run with file-based configuration.

#[cfg(windows)]
use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, REG_DWORD, REG_SZ,
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

    unsafe { RegCloseKey(key); }

    Ok(())
}

/// Register the AppUserModelID so Windows recognizes PiDesk as a
/// toast-notification-capable app.
///
/// WinRT toasts require the AUMID to be resolvable: either via a Start Menu
/// shortcut stamped with the AUMID, or via this HKCU registration. The NSIS
/// installer does not stamp the shortcut with the AUMID (confirmed: the
/// generated PiDesk.lnk contains no AppUserModelID), so we register it here
/// at startup. This also makes PiDesk appear under
/// Settings > System > Notifications, where the user can toggle it.
pub fn ensure_aumid_registration() -> Result<(), String> {
    #[cfg(windows)]
    {
        ensure_aumid_registration_windows()
    }

    #[cfg(not(windows))]
    {
        Ok(())
    }
}

#[cfg(windows)]
const AUMID: &str = "com.pidesk.app";

/// App icon embedded at compile time so toast notifications can reference a
/// real image file instead of the executable. Windows cannot reliably
/// extract icons from unsigned executables, which leaves toasts icon-less.
#[cfg(windows)]
static APP_ICON: &[u8] = include_bytes!("../icons/icon.ico");

/// Write the embedded icon next to the running executable so Windows toast
/// notifications have a real icon file to display. Returns the icon path as
/// a Windows path string, or None if the file cannot be written.
#[cfg(windows)]
fn ensure_icon_file() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let icon_path = dir.join("pidesk.ico");
    if std::fs::write(&icon_path, APP_ICON).is_ok() || icon_path.exists() {
        icon_path.to_str().map(|s| s.to_string())
    } else {
        None
    }
}

#[cfg(windows)]
fn ensure_aumid_registration_windows() -> Result<(), String> {
    let key_path = format!("Software\\Classes\\AppUserModelId\\{}", AUMID);
    let key_name: Vec<u16> = key_path.encode_utf16().chain(std::iter::once(0)).collect();

    let mut key: HKEY = std::ptr::null_mut();
    let status = unsafe { RegCreateKeyW(HKEY_CURRENT_USER, key_name.as_ptr(), &mut key) };
    if status != 0 {
        return Err(format!("RegCreateKeyW(AppUserModelId) failed with code {}", status));
    }

    set_reg_string(key, "DisplayName", "PiDesk");
    // IconUri must point at an actual image file, not the exe: Windows
    // extracts icons from unsigned executables unreliably, leaving toast
    // notifications without an icon. Ship a real .ico next to the exe.
    match ensure_icon_file() {
        Some(icon) => set_reg_string(key, "IconUri", &icon),
        None => {
            if let Ok(exe) = std::env::current_exe() {
                if let Some(path) = exe.to_str() {
                    set_reg_string(key, "IconUri", path);
                }
            }
        }
    }
    // Make PiDesk appear in Settings > System > Notifications.
    set_reg_dword(key, "ShowInSettings", 1);

    unsafe { RegCloseKey(key); }

    Ok(())
}

#[cfg(windows)]
fn set_reg_string(key: HKEY, name: &str, value: &str) {
    let name_u: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    let value_u: Vec<u16> = value.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let _ = RegSetValueExW(
            key,
            name_u.as_ptr(),
            0,
            REG_SZ,
            value_u.as_ptr() as *const u8,
            (value_u.len() * std::mem::size_of::<u16>()) as u32,
        );
    }
}

#[cfg(windows)]
fn set_reg_dword(key: HKEY, name: &str, value: u32) {
    let name_u: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let _ = RegSetValueExW(
            key,
            name_u.as_ptr(),
            0,
            REG_DWORD,
            (&value as *const u32) as *const u8,
            std::mem::size_of::<u32>() as u32,
        );
    }
}
