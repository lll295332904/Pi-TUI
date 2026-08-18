use crate::commands::images::load_image_parts;
use crate::error::{AppError, AppErrorDto, AppResult};
use crate::pi_kernel::PiRequest;
use crate::AppState;
use tauri::State;

macro_rules! send_cmd {
    ($state:expr, $session_id:expr, $req:expr) => {{
        let kernel = $state.kernel.lock().await;
        kernel
            .send_request(&$session_id, &$req)
            .await
            .map_err(|e| AppErrorDto::from(AppError::PiProcessExited { detail: e.to_string() }))
    }};
}

#[tauri::command]
pub async fn prompt(
    state: State<'_, AppState>,
    session_id: String,
    message: String,
    images: Vec<String>,
) -> AppResult<()> {
    // Convert image file paths into Pi ImageContent parts (base64 inline data).
    // Pi rejects raw path strings in the images array, which silently broke
    // image prompts (empty/malformed user content, no agent activity).
    let image_parts = load_image_parts(images)?;
    send_cmd!(state, session_id, PiRequest::Prompt { message, images: image_parts })
}

#[tauri::command]
pub async fn steer(
    state: State<'_, AppState>,
    session_id: String,
    message: String,
) -> AppResult<()> {
    send_cmd!(state, session_id, PiRequest::Steer { message })
}

#[tauri::command]
pub async fn follow_up(
    state: State<'_, AppState>,
    session_id: String,
    message: String,
) -> AppResult<()> {
    send_cmd!(state, session_id, PiRequest::FollowUp { message })
}

#[tauri::command]
pub async fn abort(
    state: State<'_, AppState>,
    session_id: String,
) -> AppResult<()> {
    send_cmd!(state, session_id, PiRequest::Abort)
}

#[tauri::command]
pub async fn set_model(
    state: State<'_, AppState>,
    session_id: String,
    provider: String,
    model_id: String,
    id: Option<String>,
) -> AppResult<()> {
    if model_id.is_empty() || model_id == "undefined" || model_id == "null" {
        return Err(AppError::ModelNotFound { detail: format!("Invalid model ID: '{}'. Please select a model in Settings -> Model.", model_id) }.into());
    }
    send_cmd!(state, session_id, PiRequest::SetModel {
        provider,
        model: model_id,
        id,
    })
}

#[tauri::command]
pub async fn set_thinking_level(
    state: State<'_, AppState>,
    session_id: String,
    level: String,
) -> AppResult<()> {
    send_cmd!(state, session_id, PiRequest::SetThinkingLevel { level })
}

#[tauri::command]
pub async fn set_steering_mode(
    state: State<'_, AppState>,
    session_id: String,
    mode: String,
) -> AppResult<()> {
    send_cmd!(state, session_id, PiRequest::SetSteeringMode { mode })
}

#[tauri::command]
pub async fn set_follow_up_mode(
    state: State<'_, AppState>,
    session_id: String,
    mode: String,
) -> AppResult<()> {
    send_cmd!(state, session_id, PiRequest::SetFollowUpMode { mode })
}

#[tauri::command]
pub async fn set_auto_compaction(
    state: State<'_, AppState>,
    session_id: String,
    enabled: bool,
) -> AppResult<()> {
    send_cmd!(state, session_id, PiRequest::SetAutoCompaction { enabled })
}

#[tauri::command]
pub async fn set_auto_retry(
    state: State<'_, AppState>,
    session_id: String,
    enabled: bool,
) -> AppResult<()> {
    send_cmd!(state, session_id, PiRequest::SetAutoRetry { enabled })
}

#[tauri::command]
pub async fn respond_extension_ui(
    state: State<'_, AppState>,
    session_id: String,
    request_id: String,
    response: serde_json::Value,
) -> AppResult<()> {
    send_cmd!(state, session_id, PiRequest::ExtensionUiResponse {
        id: request_id,
        data: response,
    })
}

#[tauri::command]
pub async fn new_session(
    state: State<'_, AppState>,
    session_id: String,
) -> AppResult<()> {
    send_cmd!(state, session_id, PiRequest::NewSession)
}

#[tauri::command]
pub async fn get_entries(
    state: State<'_, AppState>,
    session_id: String,
    since: Option<String>,
) -> AppResult<serde_json::Value> {
    send_cmd!(state, session_id, PiRequest::GetEntries { since })?;
    Ok(serde_json::json!({ "status": "sent" }))
}

#[tauri::command]
pub async fn get_tree(
    state: State<'_, AppState>,
    session_id: String,
) -> AppResult<serde_json::Value> {
    send_cmd!(state, session_id, PiRequest::GetTree)?;
    Ok(serde_json::json!({ "status": "sent" }))
}

#[tauri::command]
pub async fn fork_session(
    state: State<'_, AppState>,
    session_id: String,
    entry_id: String,
) -> AppResult<()> {
    send_cmd!(state, session_id, PiRequest::Fork { entry_id })
}

#[tauri::command]
pub async fn switch_session(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> AppResult<()> {
    send_cmd!(state, session_id, PiRequest::SwitchSession { path })
}

#[tauri::command]
pub async fn bash_exec(
    state: State<'_, AppState>,
    session_id: String,
    command: String,
) -> AppResult<()> {
    send_cmd!(state, session_id, PiRequest::Bash { command })
}

#[tauri::command]
pub async fn compact(
    state: State<'_, AppState>,
    session_id: String,
) -> AppResult<()> {
    send_cmd!(state, session_id, PiRequest::Compact)
}

#[tauri::command]
pub async fn export_html(
    state: State<'_, AppState>,
    session_id: String,
    out: Option<String>,
) -> AppResult<serde_json::Value> {
    send_cmd!(state, session_id, PiRequest::ExportHtml { out })?;
    Ok(serde_json::json!({ "status": "exporting" }))
}
