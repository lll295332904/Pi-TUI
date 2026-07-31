use std::path::PathBuf;
use std::process::Command;

/// Locate the Pi CLI executable on the system.
/// Search order:
/// 1. Bundled pi-launcher.cmd in the Tauri resource dir (portable)
/// 2. PI_CLI_PATH env var (explicit override)
/// 3. npm global bin directory
/// 4. system PATH
pub fn find_pi_cli() -> Result<PathBuf, String> {
    // 0. Check bundled pi in resource directory (next to exe, or resources/ subdir)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for d in &[dir.join("pi-bundle"), dir.join("resources").join("pi-bundle")] {
                let bundled = d.join("pi-launcher.cmd");
                if bundled.exists() {
                    return Ok(bundled);
                }
            }
        }
    }

    // 1. Explicit override: PI_CLI_PATH env var
    if let Ok(path) = std::env::var("PI_CLI_PATH") {
        let p = PathBuf::from(&path);
        if p.exists() {
            return Ok(p);
        }
    }

    // Helper: check if a path is a valid pi executable
    let check_pi = |p: &PathBuf| -> bool {
        if !p.exists() {
            return false;
        }
        // Quick version check
        if let Ok(output) = Command::new(p).arg("--version").output() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            stdout.contains("pi") || output.status.success()
        } else {
            false
        }
    };

    // 2. Check npm global prefix
    if let Ok(prefix) = get_npm_global_prefix() {
        let pi_cmd = prefix.join("pi.cmd");
        if check_pi(&pi_cmd) {
            return Ok(pi_cmd);
        }
        let pi = prefix.join("pi");
        if check_pi(&pi) {
            return Ok(pi);
        }
    }

    // 3. Check PATH
    if let Ok(paths) = std::env::var("PATH") {
        for dir in std::env::split_paths(&paths) {
            let pi_cmd = dir.join("pi.cmd");
            if pi_cmd.exists() {
                return Ok(pi_cmd);
            }
            let pi = dir.join("pi");
            if pi.exists() {
                return Ok(pi);
            }
        }
    }

    // 4. Common locations on Windows
    let common = vec![
        dirs_sys_fallback(),
        "%APPDATA%\\npm\\pi.cmd".to_string(),
        "%APPDATA%\\npm\\pi".to_string(),
    ];
    for loc in common {
        let expanded = expand_env(&loc);
        let p = PathBuf::from(&expanded);
        if check_pi(&p) {
            return Ok(p);
        }
    }

    Err("Cannot find `pi` CLI. Please install Pi Agent: npm install -g @earendil-works/pi-coding-agent".into())
}

fn get_npm_global_prefix() -> Result<PathBuf, String> {
    // Try `npm config get prefix`
    if let Ok(output) = Command::new("npm").args(["config", "get", "prefix"]).output() {
        let prefix = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !prefix.is_empty() {
            return Ok(PathBuf::from(prefix));
        }
    }
    // Fallback: common npm global location on Windows
    if let Ok(appdata) = std::env::var("APPDATA") {
        return Ok(PathBuf::from(appdata).join("npm"));
    }
    Err("Cannot determine npm global prefix".into())
}

fn dirs_sys_fallback() -> String {
    if let Ok(appdata) = std::env::var("APPDATA") {
        format!("{}\\npm\\pi.cmd", appdata)
    } else {
        "%APPDATA%\\npm\\pi.cmd".to_string()
    }
}

fn expand_env(s: &str) -> String {
    let re = regex_lite_simple();
    re.replace_all(s, |cap: &str| {
        std::env::var(&cap[2..cap.len()-1]).unwrap_or_default()
    }).to_string()
}

/// Very simple env var expansion: %VAR% -> value
fn regex_lite_simple() -> SimpleExpander {
    SimpleExpander
}

struct SimpleExpander;

impl SimpleExpander {
    fn replace_all(&self, s: &str, f: impl Fn(&str) -> String) -> String {
        let mut result = String::new();
        let chars: Vec<char> = s.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            if chars[i] == '%' {
                let start = i;
                i += 1;
                let mut var = String::new();
                while i < chars.len() && chars[i] != '%' {
                    var.push(chars[i]);
                    i += 1;
                }
                if i < chars.len() {
                    i += 1; // skip closing %
                    result.push_str(&f(&s[start..i]));
                } else {
                    result.push_str(&s[start..]);
                }
            } else {
                result.push(chars[i]);
                i += 1;
            }
        }
        result
    }
}

/// Get the installed Pi version
pub fn get_pi_version() -> Result<String, String> {
    let cli = find_pi_cli()?;
    let output = Command::new(&cli)
        .arg("--version")
        .output()
        .map_err(|e| format!("Failed to run pi --version: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(stdout)
}
