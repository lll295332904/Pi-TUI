use crate::AppState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, State};

fn get_pi_sessions_dir() -> std::path::PathBuf {
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".into());
    std::path::PathBuf::from(&home).join(".pi").join("agent").join("sessions")
}

/// Decode Pi's encoded session directory name back to a cwd.
///
/// Pi encoding (from session-manager.js):
///   `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`
///
/// Perfect decoding is lossy because `/`, `\\`, and `:` all become `-`.
/// We apply a Windows-first heuristic: if the first character is a drive
/// letter followed by `-`, reconstruct `X:\\...`; otherwise treat `-` as `/`.
fn decode_session_dir_name(dir_name: &str) -> String {
    let inner = dir_name
        .strip_prefix("--")
        .and_then(|s| s.strip_suffix("--"))
        .unwrap_or(dir_name);

    if inner.is_empty() {
        return dir_name.into();
    }

    let mut chars = inner.chars();
    if let Some(first) = chars.next() {
        let rest: String = chars.collect();
        if first.is_ascii_alphabetic() && rest.starts_with('-') {
            let after_drive = &rest[1..];
            return format!("{}:\\{}", first, after_drive.replace('-', "\\"));
        }
    }

    // Unix / relative path fallback
    inner.replace('-', "/")
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PiSessionMeta {
    pub id: String,
    pub cwd: String,
    pub last_modified: u64,
    pub entry_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionEntryVm {
    pub id: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub parent_id: Option<String>,
    pub role: Option<String>,
    pub content: Option<String>,
    pub thinking: Option<String>,
    pub timestamp: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionOpts {
    pub cwd: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

#[tauri::command]
pub async fn start_session(
    app: AppHandle,
    state: State<'_, AppState>,
    opts: SessionOpts,
) -> Result<String, String> {
    let mut kernel = state.kernel.lock().await;
    kernel
        .start_session(app, opts.cwd, opts.provider, opts.model)
        .await
        .map_err(|e| format!("Failed to start session: {}", e))
}

#[tauri::command]
pub async fn stop_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let mut kernel = state.kernel.lock().await;
    kernel
        .stop_session(&session_id)
        .await
        .map_err(|e| format!("Failed to stop session: {}", e))
}

#[tauri::command]
pub fn locate_pi() -> Result<serde_json::Value, String> {
    let version = crate::pi_locator::get_pi_version().unwrap_or_else(|_| "unknown".into());
    Ok(serde_json::json!({
        "version": version,
        "path": "pi"
    }))
}

#[tauri::command]
pub fn get_pi_version_cmd() -> Result<String, String> {
    crate::pi_locator::get_pi_version()
}

#[tauri::command]
pub fn list_pi_sessions() -> Result<Vec<PiSessionMeta>, String> {
    let sessions_dir = get_pi_sessions_dir();
    if !sessions_dir.exists() {
        return Ok(vec![]);
    }

    let dir_entries = std::fs::read_dir(&sessions_dir)
        .map_err(|e| format!("Cannot read sessions dir: {}", e))?;

    let mut sessions: Vec<PiSessionMeta> = Vec::new();

    for entry in dir_entries {
        let entry = entry.map_err(|e| format!("Dir entry error: {}", e))?;
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }

        let dir_name = entry.file_name().to_string_lossy().to_string();
        let dir_path = entry.path();

        // Read first JSONL file to extract cwd from session entry
        let mut jsonl_files: Vec<std::path::PathBuf> = std::fs::read_dir(&dir_path)
            .map_err(|e| format!("Cannot read session dir: {}", e))?
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path()
                    .extension()
                    .map_or(false, |ext| ext == "jsonl")
            })
            .map(|e| e.path())
            .collect();

        jsonl_files.sort();

        let (cwd, entry_count) = {
            let mut total = 0usize;
            let mut found_cwd: Option<String> = None;

            for file in &jsonl_files {
                if let Ok(content) = std::fs::read_to_string(file) {
                    for line in content.lines() {
                        if line.trim().is_empty() {
                            continue;
                        }
                        total += 1;
                        if found_cwd.is_none() {
                            if let Ok(val) = serde_json::from_str::<Value>(line) {
                                if val.get("type").and_then(|v| v.as_str()) == Some("session") {
                                    found_cwd = val
                                        .get("cwd")
                                        .and_then(|v| v.as_str())
                                        .map(String::from);
                                }
                            }
                        }
                    }
                }
            }

            (
                found_cwd.unwrap_or_else(|| decode_session_dir_name(&dir_name)),
                total,
            )
        };

        let last_modified = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        sessions.push(PiSessionMeta {
            id: dir_name,
            cwd,
            last_modified,
            entry_count,
        });
    }

    // Filter out empty session directories (no entries = no actual conversation)
    sessions.retain(|s| s.entry_count > 0);
    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

#[tauri::command]
pub fn load_session_entries(session_dir: String) -> Result<Vec<SessionEntryVm>, String> {
    let sessions_dir = get_pi_sessions_dir();
    let dir_path = sessions_dir.join(&session_dir);

    if !dir_path.exists() {
        return Err(format!("Session directory not found: {}", dir_path.display()));
    }

    let mut files: Vec<std::path::PathBuf> = std::fs::read_dir(&dir_path)
        .map_err(|e| format!("Cannot read dir: {}", e))?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map_or(false, |ext| ext == "jsonl")
        })
        .map(|e| e.path())
        .collect();

    files.sort();

    let mut entries: Vec<SessionEntryVm> = Vec::new();

    for file in &files {
        let content =
            std::fs::read_to_string(file).map_err(|e| format!("Cannot read file: {}", e))?;

        for line in content.lines() {
            if line.trim().is_empty() {
                continue;
            }

            let val: Value =
                serde_json::from_str(line).map_err(|e| format!("JSON parse error: {}", e))?;

            let entry_type = val
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let id = val
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let parent_id = val
                .get("parentId")
                .and_then(|v| v.as_str())
                .map(String::from);
            let timestamp = val
                .get("timestamp")
                .and_then(|v| v.as_str())
                .map(String::from);

            if entry_type != "message" {
                continue;
            }

            let msg = &val["message"];
            let role = msg
                .get("role")
                .and_then(|v| v.as_str())
                .map(String::from);
            let content_blocks = &msg["content"];

            let mut text = String::new();
            let mut thinking = String::new();

            if let Some(blocks) = content_blocks.as_array() {
                for block in blocks {
                    let block_type = block
                        .get("type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    match block_type {
                        "text" => {
                            if let Some(t) = block.get("text").and_then(|v| v.as_str()) {
                                if !text.is_empty() {
                                    text.push('\n');
                                }
                                text.push_str(t);
                            }
                        }
                        "thinking" => {
                            if let Some(t) = block.get("thinking").and_then(|v| v.as_str()) {
                                if !thinking.is_empty() {
                                    thinking.push('\n');
                                }
                                thinking.push_str(t);
                            }
                        }
                        _ => {}
                    }
                }
            }

            entries.push(SessionEntryVm {
                id,
                entry_type,
                parent_id,
                role,
                content: if text.is_empty() { None } else { Some(text) },
                thinking: if thinking.is_empty() {
                    None
                } else {
                    Some(thinking)
                },
                timestamp,
            });
        }
    }

    Ok(entries)
}

/// Check if a Pi session process is still alive
#[tauri::command]
pub async fn check_pi_health(session_id: String, state: State<'_, AppState>) -> Result<bool, String> {
    let mut kernel = state.kernel.lock().await;
    Ok(kernel.is_alive(&session_id).await)
}
