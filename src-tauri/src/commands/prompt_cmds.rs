use crate::pi_kernel::PiRequest;
use crate::AppState;
use serde::Serialize;
use tauri::State;

macro_rules! send_cmd {
    ($state:expr, $session_id:expr, $req:expr) => {{
        let kernel = $state.kernel.lock().await;
        kernel
            .send_request(&$session_id, &$req)
            .await
            .map_err(|e| format!("Failed: {}", e))
    }};
}

#[tauri::command]
pub async fn prompt(
    state: State<'_, AppState>,
    session_id: String,
    message: String,
    images: Vec<String>,
) -> Result<(), String> {
    send_cmd!(state, session_id, PiRequest::Prompt { message, images })
}

#[tauri::command]
pub async fn steer(
    state: State<'_, AppState>,
    session_id: String,
    message: String,
) -> Result<(), String> {
    send_cmd!(state, session_id, PiRequest::Steer { message })
}

#[tauri::command]
pub async fn follow_up(
    state: State<'_, AppState>,
    session_id: String,
    message: String,
) -> Result<(), String> {
    send_cmd!(state, session_id, PiRequest::FollowUp { message })
}

#[tauri::command]
pub async fn abort(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    send_cmd!(state, session_id, PiRequest::Abort)
}

// ── Model & Thinking ──

#[derive(Debug, Serialize)]
pub struct AvailableModel {
    pub provider: String,
    pub id: String,
    pub name: String,
    pub reasoning: bool,
    pub context_window: u64,
    pub supports_vision: bool,
    pub thinking_levels: Vec<String>,
}

fn get_pi_agent_dir() -> std::path::PathBuf {
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".into());
    std::path::PathBuf::from(&home).join(".pi").join("agent")
}

#[tauri::command]
pub fn get_available_models() -> Result<Vec<AvailableModel>, String> {
    // Keep pi's models.json in sync so providers added via PiDesk
    // (models-store.json with checkedAt == null) are usable by the pi process.
    let _ = sync_models_json();

    let models_store = get_pi_agent_dir().join("models-store.json");
    if !models_store.exists() {
        return Ok(vec![]);
    }

    let content = std::fs::read_to_string(&models_store)
        .map_err(|e| format!("Cannot read models-store.json: {}", e))?;
    let json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid JSON in models-store.json: {}", e))?;

    let mut models = Vec::new();

    if let Some(providers) = json.as_object() {
        for (provider_name, provider_data) in providers {
            let model_list = provider_data.get("models");
            if let Some(model_arr) = model_list.and_then(|m| m.as_array()) {
                for model in model_arr {
                    let id = model.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let name = model.get("name").and_then(|v| v.as_str()).unwrap_or(&id).to_string();
                    let reasoning = model.get("reasoning").and_then(|v| v.as_bool()).unwrap_or(false);
                    let context_window = model.get("contextWindow").and_then(|v| v.as_u64()).unwrap_or(0);
                    let input_types = model.get("input").and_then(|v| v.as_array());
                    let supports_vision = input_types
                        .map(|arr| arr.iter().any(|t| t.as_str() == Some("image")))
                        .unwrap_or(false);

                    // Extract available thinking levels from thinkingLevelMap
                    let mut thinking_levels = Vec::new();
                    if let Some(tlm) = model.get("thinkingLevelMap").and_then(|v| v.as_object()) {
                        for level in ["off", "minimal", "low", "medium", "high", "xhigh", "max"] {
                            if tlm.contains_key(level) {
                                thinking_levels.push(level.to_string());
                            }
                        }
                    }
                    // If no thinkingLevelMap but model has reasoning, add common levels
                    if thinking_levels.is_empty() && reasoning {
                        thinking_levels = vec![
                            "off".into(), "minimal".into(), "low".into(),
                            "medium".into(), "high".into(),
                        ];
                    }
                    // Non-reasoning models only support "off"
                    if thinking_levels.is_empty() {
                        thinking_levels = vec!["off".into()];
                    }

                    models.push(AvailableModel {
                        provider: provider_name.clone(),
                        id,
                        name,
                        reasoning,
                        context_window,
                        supports_vision,
                        thinking_levels,
                    });
                }
            }
        }
    }

    Ok(models)
}

#[tauri::command]
pub fn get_thinking_levels(provider: String, model_id: String) -> Result<Vec<String>, String> {
    let models = get_available_models()?;
    let model = models.iter().find(|m| m.provider == provider && m.id == model_id);
    Ok(model.map(|m| m.thinking_levels.clone()).unwrap_or_else(|| vec!["off".into()]))
}

#[tauri::command]
pub async fn set_model(
    state: State<'_, AppState>,
    session_id: String,
    provider: String,
    model_id: String,
    id: Option<String>,
) -> Result<(), String> {
    // Reject invalid model IDs to prevent "Model not found: provider/undefined" errors
    if model_id.is_empty() || model_id == "undefined" || model_id == "null" {
        return Err(format!("Invalid model ID: '{}'. Please select a model in Settings → Model.", model_id));
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
) -> Result<(), String> {
    send_cmd!(state, session_id, PiRequest::SetThinkingLevel { level })
}

// ── Steering / FollowUp / Compaction / Retry ──

#[tauri::command]
pub async fn set_steering_mode(
    state: State<'_, AppState>,
    session_id: String,
    mode: String,
) -> Result<(), String> {
    send_cmd!(state, session_id, PiRequest::SetSteeringMode { mode })
}

#[tauri::command]
pub async fn set_follow_up_mode(
    state: State<'_, AppState>,
    session_id: String,
    mode: String,
) -> Result<(), String> {
    send_cmd!(state, session_id, PiRequest::SetFollowUpMode { mode })
}

#[tauri::command]
pub async fn set_auto_compaction(
    state: State<'_, AppState>,
    session_id: String,
    enabled: bool,
) -> Result<(), String> {
    send_cmd!(state, session_id, PiRequest::SetAutoCompaction { enabled })
}

#[tauri::command]
pub async fn set_auto_retry(
    state: State<'_, AppState>,
    session_id: String,
    enabled: bool,
) -> Result<(), String> {
    send_cmd!(state, session_id, PiRequest::SetAutoRetry { enabled })
}

// ── Extension UI Response (for approvals) ──

#[tauri::command]
pub async fn respond_extension_ui(
    state: State<'_, AppState>,
    session_id: String,
    request_id: String,
    response: serde_json::Value,
) -> Result<(), String> {
    send_cmd!(state, session_id, PiRequest::ExtensionUiResponse {
        id: request_id,
        data: response,
    })
}

// ── Session management ──

#[tauri::command]
pub async fn new_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    send_cmd!(state, session_id, PiRequest::NewSession)
}

// ── Session entries ──

#[tauri::command]
pub async fn get_entries(
    state: State<'_, AppState>,
    session_id: String,
    since: Option<String>,
) -> Result<serde_json::Value, String> {
    send_cmd!(state, session_id, PiRequest::GetEntries { since })?;
    Ok(serde_json::json!({ "status": "sent" }))
}

#[tauri::command]
pub async fn get_tree(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<serde_json::Value, String> {
    send_cmd!(state, session_id, PiRequest::GetTree)?;
    Ok(serde_json::json!({ "status": "sent" }))
}

#[tauri::command]
pub async fn fork_session(
    state: State<'_, AppState>,
    session_id: String,
    entry_id: String,
) -> Result<(), String> {
    send_cmd!(state, session_id, PiRequest::Fork { entry_id })
}

#[tauri::command]
pub async fn switch_session(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    send_cmd!(state, session_id, PiRequest::SwitchSession { path })
}

#[tauri::command]
pub async fn bash_exec(
    state: State<'_, AppState>,
    session_id: String,
    command: String,
) -> Result<(), String> {
    send_cmd!(state, session_id, PiRequest::Bash { command })
}

#[tauri::command]
pub async fn compact(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    send_cmd!(state, session_id, PiRequest::Compact)
}

#[tauri::command]
pub async fn export_html(
    state: State<'_, AppState>,
    session_id: String,
    out: Option<String>,
) -> Result<serde_json::Value, String> {
    send_cmd!(state, session_id, PiRequest::ExportHtml { out })?;
    Ok(serde_json::json!({ "status": "exporting" }))
}

// ── Pi config file read/write ──

#[tauri::command]
pub fn read_pi_file(filename: String) -> Result<String, String> {
    let path = get_pi_agent_dir().join(&filename);
    if !path.exists() {
        return Err(format!("File not found: {}", path.display()));
    }
    std::fs::read_to_string(&path).map_err(|e| format!("Cannot read file: {}", e))
}

#[tauri::command]
pub fn write_pi_file(filename: String, content: String) -> Result<(), String> {
    let path = get_pi_agent_dir().join(&filename);
    // Create backup
    if path.exists() {
        let backup = path.with_extension("json.bak");
        std::fs::copy(&path, &backup).map_err(|e| format!("Backup failed: {}", e))?;
    }
    std::fs::write(&path, &content).map_err(|e| format!("Cannot write file: {}", e))
}

#[tauri::command]
pub fn list_pi_files() -> Result<Vec<String>, String> {
    let dir = get_pi_agent_dir();
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut files = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| format!("Cannot read dir: {}", e))? {
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

// ── Add model to models-store ──

/// Sync PiDesk-managed providers (models-store.json entries with
/// `checkedAt == null`, i.e. added by PiDesk, not refreshed by pi) into
/// pi's `models.json` so the pi process actually knows these providers.
/// pi's available models = builtin providers + models.json providers;
/// models-store.json alone is only a catalog cache and is not enough.
fn sync_models_json() -> Result<(), String> {
    let agent_dir = get_pi_agent_dir();
    let store_path = agent_dir.join("models-store.json");
    let models_json_path = agent_dir.join("models.json");

    if !store_path.exists() {
        return Ok(());
    }
    let store: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(&store_path)
            .map_err(|e| format!("Cannot read models-store.json: {}", e))?,
    )
    .map_err(|e| format!("Invalid models-store.json: {}", e))?;

    // Keep any user-manual provider config already present in models.json.
    let mut models_json: serde_json::Value = if models_json_path.exists() {
        std::fs::read_to_string(&models_json_path)
            .ok()
            .and_then(|c| serde_json::from_str(&c).ok())
            .unwrap_or(serde_json::json!({ "providers": {} }))
    } else {
        serde_json::json!({ "providers": {} })
    };
    if !models_json.is_object() {
        models_json = serde_json::json!({ "providers": {} });
    }
    let providers = models_json
        .get_mut("providers")
        .and_then(|p| p.as_object_mut());
    if providers.is_none() {
        models_json["providers"] = serde_json::json!({});
    }
    let providers = models_json["providers"].as_object_mut().unwrap();

    if let Some(store_obj) = store.as_object() {
        for (pid, entry) in store_obj {
            let checked_at = entry.get("checkedAt");
            let managed = checked_at.map(|v| v.is_null()).unwrap_or(true);
            let models = entry.get("models").and_then(|m| m.as_array());
            let has_models = models.map(|a| !a.is_empty()).unwrap_or(false);
            if !managed || !has_models {
                continue;
            }
            let model_list = models.unwrap();
            let models_defs: Vec<serde_json::Value> = model_list
                .iter()
                .map(|m| {
                    let mut def = serde_json::Map::new();
                    for key in [
                        "id", "name", "api", "baseUrl", "reasoning",
                        "thinkingLevelMap", "input", "cost", "contextWindow",
                        "maxTokens", "compat",
                    ] {
                        if let Some(v) = m.get(key) {
                            def.insert(key.to_string(), v.clone());
                        }
                    }
                    serde_json::Value::Object(def)
                })
                .collect();

            let mut p = serde_json::Map::new();
            p.insert("name".to_string(), serde_json::json!(pid));
            if let Some(b) = model_list.first().and_then(|m| m.get("baseUrl")).cloned() {
                p.insert("baseUrl".to_string(), b);
            }
            if let Some(a) = model_list.first().and_then(|m| m.get("api")).cloned() {
                p.insert("api".to_string(), a);
            }
            if let Some(c) = model_list.first().and_then(|m| m.get("compat")).cloned() {
                p.insert("compat".to_string(), c);
            }
            p.insert("models".to_string(), serde_json::Value::Array(models_defs));
            providers.insert(pid.clone(), serde_json::Value::Object(p));
        }
    }

    let updated = serde_json::to_string_pretty(&models_json)
        .map_err(|e| format!("Serialize models.json error: {}", e))?;
    std::fs::write(&models_json_path, updated)
        .map_err(|e| format!("Cannot write models.json: {}", e))?;
    Ok(())
}

#[derive(Debug, serde::Deserialize)]
pub struct NewModelParams {
    pub provider: String,
    pub model_id: String,
    pub display_name: String,
    pub api_type: String,       // "openai-completions" | "anthropic-messages"
    pub api_base_url: String,
    pub api_key: Option<String>,
    pub reasoning: bool,
    pub supports_vision: bool,
    pub context_window: u64,
    pub max_tokens: u64,
}

fn backup_file(path: &std::path::Path) -> Result<(), String> {
    if path.exists() {
        let backup = path.with_extension("json.bak");
        std::fs::copy(path, &backup)
            .map_err(|e| format!("Backup failed: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn add_model(params: NewModelParams) -> Result<(), String> {
    let agent_dir = get_pi_agent_dir();
    // Ensure ~/.pi/agent exists on fresh installs
    std::fs::create_dir_all(&agent_dir)
        .map_err(|e| format!("Cannot create ~/.pi/agent: {}", e))?;

    // === 1. Update models-store.json ===
    let models_path = agent_dir.join("models-store.json");
    let _ = backup_file(&models_path);

    let mut models_store: serde_json::Value = if models_path.exists() {
        let content = std::fs::read_to_string(&models_path)
            .map_err(|e| format!("Cannot read models-store.json: {}", e))?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Build thinkingLevelMap based on reasoning
    let thinking_level_map = if params.reasoning {
        serde_json::json!({
            "off": null,
            "minimal": null,
            "low": null,
            "medium": null,
            "high": "high",
            "max": "max"
        })
    } else {
        serde_json::json!({ "off": null })
    };

    // Build input types
    let mut input_types = vec!["text"];
    if params.supports_vision {
        input_types.push("image");
    }

    // Build compat based on api_type
    let compat = if params.api_type == "anthropic-messages" {
        serde_json::json!({
            "thinkingFormat": "anthropic"
        })
    } else {
        serde_json::json!({
            "thinkingFormat": "deepseek"
        })
    };

    let new_model = serde_json::json!({
        "id": params.model_id,
        "name": params.display_name,
        "api": params.api_type,
        "baseUrl": params.api_base_url,
        "provider": params.provider,
        "reasoning": params.reasoning,
        "input": input_types,
        "contextWindow": params.context_window,
        "maxTokens": params.max_tokens,
        "thinkingLevelMap": thinking_level_map,
        "compat": compat,
        "cost": {
            "input": 0,
            "output": 0,
            "cacheRead": 0,
            "cacheWrite": 0
        }
    });

    // Insert into models-store under the provider key
    let provider_entry = models_store
        .get_mut(&params.provider)
        .cloned()
        .unwrap_or(serde_json::json!({
            "models": [],
            "checkedAt": null,
            "lastModified": null
        }));

    let mut provider_obj = provider_entry.as_object()
        .cloned()
        .unwrap_or_default();

    // Get or create models array
    let models_arr = provider_obj
        .get("models")
        .and_then(|m| m.as_array())
        .cloned()
        .unwrap_or_default();

    // Remove existing model with same id, then add new one
    let mut updated_models: Vec<serde_json::Value> = models_arr
        .into_iter()
        .filter(|m| m.get("id").and_then(|v| v.as_str()) != Some(&params.model_id))
        .collect();
    updated_models.push(new_model);

    provider_obj.insert("models".into(), serde_json::Value::Array(updated_models));
    models_store[&params.provider] = serde_json::Value::Object(provider_obj);

    let updated_json = serde_json::to_string_pretty(&models_store)
        .map_err(|e| format!("Serialize error: {}", e))?;
    std::fs::write(&models_path, &updated_json)
        .map_err(|e| format!("Cannot write models-store.json: {}", e))?;

    // === 2. Update auth.json if API key provided ===
    if let Some(ref key) = params.api_key {
        if !key.trim().is_empty() {
            let auth_path = agent_dir.join("auth.json");
            let _ = backup_file(&auth_path);

            let mut auth: serde_json::Value = if auth_path.exists() {
                let content = std::fs::read_to_string(&auth_path)
                    .map_err(|e| format!("Cannot read auth.json: {}", e))?;
                serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
            } else {
                serde_json::json!({})
            };

            auth[&params.provider] = serde_json::json!({
                "type": "api_key",
                "key": key,
            });

            let updated_auth = serde_json::to_string_pretty(&auth)
                .map_err(|e| format!("Serialize error: {}", e))?;
            std::fs::write(&auth_path, &updated_auth)
                .map_err(|e| format!("Cannot write auth.json: {}", e))?;
        }
    }

    // Register PiDesk-managed providers in pi's models.json
    let _ = sync_models_json();

    Ok(())
}

// ── Remove model ──

#[tauri::command]
pub fn remove_model(provider: String, model_id: String) -> Result<(), String> {
    let models_path = get_pi_agent_dir().join("models-store.json");
    if models_path.exists() {
        let _ = std::fs::copy(&models_path, models_path.with_extension("json.bak"));
    }
    let content = std::fs::read_to_string(&models_path)
        .map_err(|e| format!("Cannot read: {}", e))?;
    let mut store: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid JSON: {}", e))?;
    if let Some(provider_obj) = store.get_mut(&provider) {
        if let Some(models) = provider_obj.get_mut("models") {
            if let Some(arr) = models.as_array_mut() {
                arr.retain(|m| m.get("id").and_then(|v| v.as_str()) != Some(&model_id));
            }
        }
        if provider_obj.get("models").and_then(|m| m.as_array()).map(|a| a.is_empty()).unwrap_or(false) {
            if let Some(obj) = store.as_object_mut() {
                obj.remove(&provider);
            }
        }
    }
    let updated = serde_json::to_string_pretty(&store)
        .map_err(|e| format!("Serialize error: {}", e))?;
    std::fs::write(&models_path, &updated)
        .map_err(|e| format!("Cannot write: {}", e))?;

    // Re-sync models.json after removing a model
    let _ = sync_models_json();

    Ok(())
}

// ── Fetch models from OpenAI-compatible API ──

#[derive(Debug, serde::Serialize)]
pub struct FetchedModel {
    pub id: String,
    pub owned_by: Option<String>,
}

#[tauri::command]
pub async fn fetch_models_from_url(base_url: String, api_key: Option<String>) -> Result<Vec<FetchedModel>, String> {
    let url = if base_url.ends_with('/') {
        format!("{}models", base_url)
    } else {
        format!("{}/models", base_url)
    };

    let client = reqwest::Client::new();
    let mut req = client.get(&url);

    if let Some(key) = &api_key {
        if !key.trim().is_empty() {
            req = req.header("Authorization", format!("Bearer {}", key));
        }
    }

    let resp = req.send().await.map_err(|e| format!("HTTP request failed: {}", e))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("Failed to read response body: {}", e))?;

    if !status.is_success() {
        let snippet = if text.len() > 500 { &text[..500] } else { &text };
        return Err(format!("HTTP {} from {}: {}", status.as_u16(), url, snippet));
    }

    let body: serde_json::Value = serde_json::from_str(&text).map_err(|e| {
        let snippet = if text.len() > 500 { &text[..500] } else { &text };
        format!("JSON parse failed: {} — response body: {}", e, snippet)
    })?;

    let data = body.get("data")
        .and_then(|d| d.as_array())
        .ok_or("Response missing 'data' array")?;

    let models: Vec<FetchedModel> = data.iter()
        .filter_map(|item| {
            Some(FetchedModel {
                id: item.get("id")?.as_str()?.to_string(),
                owned_by: item.get("owned_by").and_then(|v| v.as_str()).map(String::from),
            })
        })
        .collect();

    Ok(models)
}

// ── Userdata persistence (projects, pinned, sessionNames) ──

#[tauri::command]
pub fn save_userdata(data: serde_json::Value) -> Result<(), String> {
    let path = get_pi_agent_dir().join("userdata.json");
    // Backup before write
    if path.exists() {
        let bak = path.with_extension("json.bak");
        let _ = std::fs::copy(&path, &bak);
    }
    let content = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("Serialize error: {}", e))?;
    std::fs::write(&path, &content)
        .map_err(|e| format!("Cannot write userdata.json: {}", e))
}

#[tauri::command]
pub fn load_userdata() -> Result<serde_json::Value, String> {
    let path = get_pi_agent_dir().join("userdata.json");
    if !path.exists() { return Ok(serde_json::json!({})); }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Cannot read userdata.json: {}", e))?;
    match serde_json::from_str(&content) {
        Ok(v) => Ok(v),
        Err(_) => {
            // Try recovery from backup
            let bak = path.with_extension("json.bak");
            if bak.exists() {
                let bak_content = std::fs::read_to_string(&bak)
                    .map_err(|e| format!("Cannot read backup: {}", e))?;
                // Restore backup as main file
                let _ = std::fs::write(&path, &bak_content);
                serde_json::from_str(&bak_content)
                    .map_err(|e| format!("Backup also invalid: {}", e))
            } else {
                Err("userdata.json is corrupted and no backup found".into())
            }
        }
    }
}
