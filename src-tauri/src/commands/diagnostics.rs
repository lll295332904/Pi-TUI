use crate::AppState;
use serde::Serialize;
use tauri::State;

/// A single diagnostic check result
#[derive(Debug, Clone, Serialize)]
pub struct CheckItem {
    pub ok: bool,
    pub detail: String,
}

/// Errors found during diagnostics
#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticError {
    pub component: String,
    pub message: String,
}

/// Full startup diagnostic report
#[derive(Debug, Clone, Serialize)]
pub struct StartupDiagnostics {
    pub ok: bool,
    pub pi_bundle: PiBundleChecks,
    pub user_data: UserDataChecks,
    pub versions: VersionInfo,
    pub errors: Vec<DiagnosticError>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PiBundleChecks {
    pub node: CheckItem,
    pub package_json: CheckItem,
    pub rpc_entry: CheckItem,
    pub index_entry: CheckItem,
    pub node_modules: CheckItem,
}

#[derive(Debug, Clone, Serialize)]
pub struct UserDataChecks {
    pub pi_agent_dir: String,
    pub readable: bool,
    pub writable: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct VersionInfo {
    pub app_version: String,
    pub bundled_pi_version: Option<String>,
}

fn get_pi_agent_dir() -> std::path::PathBuf {
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".into());
    std::path::PathBuf::from(&home).join(".pi").join("agent")
}

fn find_bundle_root() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    for root in &[
        dir.join("pi-bundle"),
        dir.join("resources").join("pi-bundle"),
    ] {
        if root.exists() {
            return Some(root.clone());
        }
    }
    None
}

fn run_startup_diagnostics_impl() -> StartupDiagnostics {
    let mut errors: Vec<DiagnosticError> = Vec::new();
    let bundle_root = find_bundle_root();

    let pi_bundle = if let Some(ref root) = bundle_root {
        let node_exe = root.join("node.exe");
        let pkg_json = root.join("package.json");
        let rpc_entry = root.join("dist").join("rpc-entry.js");
        let index_entry = root.join("dist").join("index.js");
        let node_modules = root.join("node_modules");
        let openai_pkg = node_modules.join("openai").join("package.json");

        let node_check = CheckItem {
            ok: node_exe.exists(),
            detail: node_exe.to_string_lossy().to_string(),
        };
        let pkg_check = CheckItem {
            ok: pkg_json.exists(),
            detail: pkg_json.to_string_lossy().to_string(),
        };
        let rpc_check = CheckItem {
            ok: rpc_entry.exists(),
            detail: rpc_entry.to_string_lossy().to_string(),
        };
        let index_check = CheckItem {
            ok: index_entry.exists(),
            detail: index_entry.to_string_lossy().to_string(),
        };
        let nm_check = CheckItem {
            ok: node_modules.exists() && openai_pkg.exists(),
            detail: node_modules.to_string_lossy().to_string(),
        };

        if !node_check.ok {
            errors.push(DiagnosticError { component: "pi-bundle/node.exe".into(), message: format!("Missing: {}", node_exe.display()) });
        }
        if !pkg_check.ok {
            errors.push(DiagnosticError { component: "pi-bundle/package.json".into(), message: format!("Missing: {}", pkg_json.display()) });
        }
        if !rpc_check.ok {
            errors.push(DiagnosticError { component: "pi-bundle/dist/rpc-entry.js".into(), message: format!("Missing: {}", rpc_entry.display()) });
        }
        if !index_check.ok {
            errors.push(DiagnosticError { component: "pi-bundle/dist/index.js".into(), message: format!("Missing: {}", index_entry.display()) });
        }
        if !nm_check.ok {
            errors.push(DiagnosticError { component: "pi-bundle/node_modules".into(), message: format!("Missing or incomplete: {}", node_modules.display()) });
        }

        PiBundleChecks { node: node_check, package_json: pkg_check, rpc_entry: rpc_check, index_entry: index_check, node_modules: nm_check }
    } else {
        let missing = CheckItem { ok: false, detail: "pi-bundle directory not found".into() };
        errors.push(DiagnosticError { component: "pi-bundle".into(), message: "Cannot locate pi-bundle directory relative to executable".into() });
        PiBundleChecks { node: missing.clone(), package_json: missing.clone(), rpc_entry: missing.clone(), index_entry: missing.clone(), node_modules: missing }
    };

    let agent_dir = get_pi_agent_dir();
    let agent_dir_str = agent_dir.to_string_lossy().to_string();
    let _ = std::fs::create_dir_all(&agent_dir);
    let readable = std::fs::read_dir(&agent_dir).is_ok();
    let writable = {
        let test_file = agent_dir.join(".pidesk_write_test");
        std::fs::write(&test_file, "test").is_ok() && std::fs::remove_file(&test_file).is_ok()
    };
    if !readable {
        errors.push(DiagnosticError { component: "user-data".into(), message: format!("Cannot read: {}", agent_dir_str) });
    }
    if !writable {
        errors.push(DiagnosticError { component: "user-data".into(), message: format!("Cannot write: {}", agent_dir_str) });
    }

    let user_data = UserDataChecks { pi_agent_dir: agent_dir_str, readable, writable };

    let bundled_pi_version = bundle_root.as_ref().and_then(|root| {
        let node_exe = root.join("node.exe");
        let index_entry = root.join("dist").join("index.js");
        if node_exe.exists() && index_entry.exists() {
            std::process::Command::new(&node_exe)
                .arg(index_entry.to_string_lossy().to_string())
                .arg("--version")
                .output().ok()
                .and_then(|o| {
                    let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    if s.is_empty() { None } else { Some(s) }
                })
        } else { None }
    });

    let versions = VersionInfo { app_version: env!("CARGO_PKG_VERSION").to_string(), bundled_pi_version };

    let all_ok = errors.is_empty()
        && pi_bundle.node.ok && pi_bundle.package_json.ok
        && pi_bundle.rpc_entry.ok && pi_bundle.index_entry.ok
        && pi_bundle.node_modules.ok && user_data.readable && user_data.writable;

    StartupDiagnostics { ok: all_ok, pi_bundle, user_data, versions, errors }
}

/// Run startup diagnostics and return structured report.
#[tauri::command]
pub fn run_startup_diagnostics(state: State<'_, AppState>) -> StartupDiagnostics {
    state.logger.info("Startup diagnostics started");
    let result = run_startup_diagnostics_impl();
    if result.ok {
        state.logger.info("Startup diagnostics passed");
    } else {
        state.logger.warn(&format!("Startup diagnostics failed: {} errors", result.errors.len()));
    }
    result
}

/// Export diagnostic bundle as a text report. Returns the file path.
#[tauri::command]
pub fn export_diagnostics(state: State<'_, AppState>) -> Result<String, String> {
    state.logger.info("Diagnostic report export started");
    let diag = run_startup_diagnostics_impl();
    let log_dir = {
        let appdata = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
        std::path::PathBuf::from(appdata).join("PiDesk").join("logs")
    };
    let _ = std::fs::create_dir_all(&log_dir);
    let export_path = log_dir.join("diagnostics.txt");

    let mut report = String::new();
    report.push_str("=== PiDesk Diagnostic Report ===\n\n");
    report.push_str(&format!("App Version: {}\n", diag.versions.app_version));
    report.push_str(&format!("Bundled Pi: {}\n", diag.versions.bundled_pi_version.as_deref().unwrap_or("N/A")));
    report.push_str(&format!("Overall Status: {}\n\n", if diag.ok { "OK" } else { "FAILED" }));

    report.push_str("--- Pi Bundle ---\n");
    report.push_str(&format!("  node.exe: {} - {}\n", if diag.pi_bundle.node.ok { "OK" } else { "MISSING" }, diag.pi_bundle.node.detail));
    report.push_str(&format!("  package.json: {}\n", if diag.pi_bundle.package_json.ok { "OK" } else { "MISSING" }));
    report.push_str(&format!("  rpc-entry.js: {}\n", if diag.pi_bundle.rpc_entry.ok { "OK" } else { "MISSING" }));
    report.push_str(&format!("  index.js: {}\n", if diag.pi_bundle.index_entry.ok { "OK" } else { "MISSING" }));
    report.push_str(&format!("  node_modules: {}\n\n", if diag.pi_bundle.node_modules.ok { "OK" } else { "MISSING" }));

    report.push_str("--- User Data ---\n");
    report.push_str(&format!("  Dir: {}\n", diag.user_data.pi_agent_dir));
    report.push_str(&format!("  Readable: {}\n", diag.user_data.readable));
    report.push_str(&format!("  Writable: {}\n\n", diag.user_data.writable));

    if !diag.errors.is_empty() {
        report.push_str("--- Errors ---\n");
        for e in &diag.errors {
            report.push_str(&format!("  [{}] {}\n", e.component, e.message));
        }
        report.push('\n');
    }

    let log_path = log_dir.join("app.log");
    if log_path.exists() {
        report.push_str("--- Recent Logs ---\n");
        if let Ok(content) = std::fs::read_to_string(&log_path) {
            let lines: Vec<&str> = content.lines().rev().take(200).collect();
            for line in lines.into_iter().rev() { report.push_str(line); report.push('\n'); }
        }
    }

    let pi_log_path = log_dir.join("pi-stderr.log");
    if pi_log_path.exists() {
        report.push_str("\n--- Pi Stderr ---\n");
        if let Ok(content) = std::fs::read_to_string(&pi_log_path) {
            let lines: Vec<&str> = content.lines().rev().take(100).collect();
            for line in lines.into_iter().rev() { report.push_str(line); report.push('\n'); }
        }
    }

    std::fs::write(&export_path, &report).map_err(|e| format!("Failed to write: {}", e))?;
    state.logger.info(&format!("Diagnostic report exported to {}", export_path.display()));
    Ok(export_path.to_string_lossy().to_string())
}
