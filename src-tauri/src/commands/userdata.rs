use crate::error::{AppError, AppResult};

fn get_pi_agent_dir() -> std::path::PathBuf {
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".into());
    std::path::PathBuf::from(&home).join(".pi").join("agent")
}

#[tauri::command]
pub fn save_userdata(data: serde_json::Value) -> AppResult<()> {
    let path = get_pi_agent_dir().join("userdata.json");
    if path.exists() {
        let bak = path.with_extension("json.bak");
        let _ = std::fs::copy(&path, &bak);
    }
    let content = serde_json::to_string_pretty(&data)
        .map_err(|e| AppError::ConfigWriteFailed { detail: e.to_string() })?;
    std::fs::write(&path, &content)
        .map_err(|e| AppError::ConfigWriteFailed { detail: e.to_string() }.into())
}

#[tauri::command]
pub fn load_userdata() -> AppResult<serde_json::Value> {
    let path = get_pi_agent_dir().join("userdata.json");
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| AppError::ConfigReadFailed { detail: e.to_string() })?;
    match serde_json::from_str(&content) {
        Ok(v) => Ok(v),
        Err(_) => {
            let bak = path.with_extension("json.bak");
            if bak.exists() {
                let bak_content = std::fs::read_to_string(&bak)
                    .map_err(|e| AppError::ConfigReadFailed { detail: format!("Cannot read backup: {}", e) })?;
                let _ = std::fs::write(&path, &bak_content);
                serde_json::from_str(&bak_content)
                    .map_err(|e| AppError::ConfigReadFailed { detail: format!("Backup also invalid: {}", e) }.into())
            } else {
                Err(AppError::ConfigReadFailed { detail: "userdata.json is corrupted and no backup found".into() }.into())
            }
        }
    }
}
