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
    /// File-level ID: "dirname/filename", globally unique per .jsonl session file
    pub id: String,
    pub cwd: String,
    /// Auto-generated from first user message (first 24 chars)
    pub name: String,
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

/// Extract session cwd and auto-generated name from a .jsonl file.
/// Returns (cwd, name) where name is the first user message text truncated to 24 chars.
fn extract_session_meta(jsonl_path: &std::path::Path) -> (Option<String>, Option<String>) {
    let content = match std::fs::read_to_string(jsonl_path) {
        Ok(c) => c,
        Err(_) => return (None, None),
    };

    let mut cwd: Option<String> = None;
    let mut name: Option<String> = None;

    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let val: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let entry_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("");

        // Extract cwd from the first "session" entry
        if cwd.is_none() && entry_type == "session" {
            cwd = val.get("cwd").and_then(|v| v.as_str()).map(String::from);
        }

        // Extract name from the first user message
        if name.is_none() && entry_type == "message" {
            let msg = &val["message"];
            if msg.get("role").and_then(|v| v.as_str()) == Some("user") {
                if let Some(blocks) = msg.get("content").and_then(|v| v.as_array()) {
                    for block in blocks {
                        if block.get("type").and_then(|v| v.as_str()) == Some("text") {
                            if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                                let trimmed = text.trim();
                                let short: String = trimmed
                                    .chars()
                                    .take(24)
                                    .collect();
                                name = Some(if short.len() < trimmed.len() {
                                    format!("{}…", short)
                                } else {
                                    short
                                });
                                break;
                            }
                        }
                    }
                }
            }
        }

        if cwd.is_some() && name.is_some() {
            break;
        }
    }

    (cwd, name)
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

        // Get all .jsonl files in this directory — each is an independent session
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

        for file in &jsonl_files {
            let file_name = file
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            // Count entries and extract cwd + name
            let (cwd, name) = extract_session_meta(file);
            let entry_count = if let Ok(content) = std::fs::read_to_string(file) {
                content.lines().filter(|l| !l.trim().is_empty()).count()
            } else {
                0
            };

            if entry_count == 0 {
                continue;
            }

            let last_modified = file
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);

            sessions.push(PiSessionMeta {
                // File-level ID: "dirname/filename"
                id: format!("{}/{}", dir_name, file_name),
                cwd: cwd.unwrap_or_else(|| decode_session_dir_name(&dir_name)),
                name: name.unwrap_or_else(|| "Untitled".to_string()),
                last_modified,
                entry_count,
            });
        }
    }

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

/// Parse a file-level session ID ("dirname/filename") into its components.
fn parse_session_file_id(session_id: &str) -> (&str, &str) {
    session_id
        .split_once('/')
        .unwrap_or((session_id, ""))
}

#[tauri::command]
pub fn load_session_entries(session_id: String) -> Result<Vec<SessionEntryVm>, String> {
    let (dir_name, file_name) = parse_session_file_id(&session_id);
    let sessions_dir = get_pi_sessions_dir();
    let file_path = sessions_dir.join(dir_name).join(file_name);

    if !file_path.exists() {
        return Err(format!("Session file not found: {}", file_path.display()));
    }

    let content =
        std::fs::read_to_string(&file_path).map_err(|e| format!("Cannot read file: {}", e))?;

    let mut entries: Vec<SessionEntryVm> = Vec::new();

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

    Ok(entries)
}

/// Delete a single .jsonl session file. Cleans up the directory if it becomes empty.
#[tauri::command]
pub fn delete_pi_session(session_id: String) -> Result<(), String> {
    let (dir_name, file_name) = parse_session_file_id(&session_id);

    if file_name.is_empty() {
        return Err("Invalid session ID format".to_string());
    }

    let sessions_dir = get_pi_sessions_dir();
    let file_path = sessions_dir.join(dir_name).join(file_name);

    if file_path.exists() {
        std::fs::remove_file(&file_path)
            .map_err(|e| format!("Cannot delete session file: {}", e))?;
    }

    // Clean up directory if empty
    let dir_path = sessions_dir.join(dir_name);
    if dir_path.exists() {
        if let Ok(mut read_dir) = std::fs::read_dir(&dir_path) {
            if !read_dir.any(|e| {
                e.ok()
                    .map(|entry| {
                        entry.path().extension().map_or(false, |ext| ext == "jsonl")
                    })
                    .unwrap_or(false)
            }) {
                let _ = std::fs::remove_dir(&dir_path);
            }
        }
    }

    Ok(())
}

/// Get the Pi sessions directory path (for constructing full file paths)
#[tauri::command]
pub fn get_sessions_dir() -> Result<String, String> {
    let dir = get_pi_sessions_dir();
    Ok(dir.to_string_lossy().to_string())
}

/// Check if a Pi session process is still alive
#[tauri::command]
pub async fn check_pi_health(session_id: String, state: State<'_, AppState>) -> Result<bool, String> {
    let mut kernel = state.kernel.lock().await;
    Ok(kernel.is_alive(&session_id).await)
}
