use crate::error::{AppError, AppResult};

fn get_pi_agent_dir() -> std::path::PathBuf {
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".into());
    std::path::PathBuf::from(&home).join(".pi").join("agent")
}

#[tauri::command]
pub fn read_pi_file(filename: String) -> AppResult<String> {
    let path = get_pi_agent_dir().join(&filename);
    if !path.exists() {
        return Err(AppError::SessionFileNotFound { detail: path.display().to_string() }.into());
    }
    std::fs::read_to_string(&path)
        .map_err(|e| AppError::ConfigReadFailed { detail: e.to_string() }.into())
}

#[tauri::command]
pub fn write_pi_file(filename: String, content: String) -> AppResult<()> {
    let path = get_pi_agent_dir().join(&filename);
    if path.exists() {
        let backup = path.with_extension("json.bak");
        std::fs::copy(&path, &backup)
            .map_err(|e| AppError::ConfigWriteFailed { detail: format!("Backup failed: {}", e) })?;
    }
    std::fs::write(&path, &content)
        .map_err(|e| AppError::ConfigWriteFailed { detail: e.to_string() }.into())
}

#[tauri::command]
pub fn list_pi_files() -> AppResult<Vec<String>> {
    let dir = get_pi_agent_dir();
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut files = Vec::new();
    for entry in std::fs::read_dir(&dir)
        .map_err(|e| AppError::ConfigReadFailed { detail: e.to_string() })? {
        if let Ok(e) = entry {
            let name = e.file_name().to_string_lossy().to_string();
            if name.ends_with(".json") || name.ends_with(".jsonl") {
                files.push(name);
            }
        }
    }
    files.sort();
    Ok(files)
}
