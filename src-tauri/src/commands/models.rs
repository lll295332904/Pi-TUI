use crate::error::{AppError, AppResult};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize)]
pub struct AvailableModel {
    pub provider: String,
    pub id: String,
    pub name: String,
    pub reasoning: bool,
    #[serde(rename = "contextWindow")]
    pub context_window: u64,
    #[serde(rename = "supportsVision")]
    pub supports_vision: bool,
    #[serde(rename = "thinkingLevels")]
    pub thinking_levels: Vec<String>,
}

fn get_pi_agent_dir() -> std::path::PathBuf {
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".into());
    std::path::PathBuf::from(&home).join(".pi").join("agent")
}

/// Merge the user model catalog (`models.json`) over the directory catalog
/// (`models-store.json`) following Pi's documented merge semantics
/// (docs/models.md → "Overriding Built-in Providers"):
///   - directory models are the base
///   - user models are upserted by `id` per provider
///   - a user model with the same `id` replaces the directory model
///   - user provider-level fields (`baseUrl`/`api`/`compat`/`name`/`apiKey`) win
///
/// Returns a merged catalog in `models-store.json` shape: `{ provider: { models: [...] } }`.
/// This is the SINGLE source of truth for the UI — the UI shows exactly what
/// the Pi kernel sees, and user overrides are never clobbered.
fn merge_catalog() -> AppResult<serde_json::Value> {
    let agent_dir = get_pi_agent_dir();
    let store_path = agent_dir.join("models-store.json");
    let user_path = agent_dir.join("models.json");

    // Base: directory catalog
    let mut merged: serde_json::Value = if store_path.exists() {
        std::fs::read_to_string(&store_path)
            .ok()
            .and_then(|c| serde_json::from_str(&c).ok())
            .unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    if !merged.is_object() {
        merged = serde_json::json!({});
    }

    // Overlay: user catalog (wins on conflicts)
    let user: serde_json::Value = if user_path.exists() {
        std::fs::read_to_string(&user_path)
            .ok()
            .and_then(|c| serde_json::from_str(&c).ok())
            .unwrap_or(serde_json::json!({ "providers": {} }))
    } else {
        serde_json::json!({ "providers": {} })
    };

    if let Some(user_providers) = user.get("providers").and_then(|p| p.as_object()) {
        let merged_obj = merged.as_object_mut().unwrap();
        for (pid, user_provider) in user_providers {
            let mut entry = merged_obj
                .get(pid)
                .cloned()
                .unwrap_or(serde_json::json!({ "models": [] }));
            if !entry.is_object() {
                entry = serde_json::json!({ "models": [] });
            }
            let entry_obj = entry.as_object_mut().unwrap();

            // Upsert user models by id (user model replaces directory model with same id)
            if let Some(u_models) = user_provider.get("models").and_then(|m| m.as_array()) {
                let mut base_models: Vec<serde_json::Value> = entry_obj
                    .get("models")
                    .and_then(|m| m.as_array())
                    .cloned()
                    .unwrap_or_default();
                for u_model in u_models {
                    let uid = u_model.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    base_models.retain(|bm| bm.get("id").and_then(|v| v.as_str()) != Some(uid));
                    base_models.push(u_model.clone());
                }
                entry_obj.insert("models".to_string(), serde_json::Value::Array(base_models));
            }

            // Provider-level user overrides win over directory values
            for key in ["name", "baseUrl", "api", "compat", "apiKey"] {
                if let Some(v) = user_provider.get(key) {
                    entry_obj.insert(key.to_string(), v.clone());
                }
            }

            merged_obj.insert(pid.clone(), entry);
        }
    }

    Ok(merged)
}

#[tauri::command]
pub fn get_available_models() -> AppResult<Vec<AvailableModel>> {
    // Read the merged catalog (directory + user models, user wins).
    // The UI therefore shows exactly what the Pi kernel sees.
    let catalog = merge_catalog()?;

    let mut models = Vec::new();
    if let Some(providers) = catalog.as_object() {
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

                    // Only list thinking levels whose map value is non-null.
                    // A null value means the level is unsupported (Pi semantics).
                    let mut thinking_levels = Vec::new();
                    if let Some(tlm) = model.get("thinkingLevelMap").and_then(|v| v.as_object()) {
                        for level in ["off", "minimal", "low", "medium", "high", "xhigh", "max"] {
                            if let Some(v) = tlm.get(level) {
                                if !v.is_null() {
                                    thinking_levels.push(level.to_string());
                                }
                            }
                        }
                    }
                    if thinking_levels.is_empty() && reasoning {
                        thinking_levels = vec!["off".into(), "minimal".into(), "low".into(), "medium".into(), "high".into()];
                    }
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
pub fn get_thinking_levels(provider: String, model_id: String) -> AppResult<Vec<String>> {
    let models = get_available_models()?;
    let model = models.iter().find(|m| m.provider == provider && m.id == model_id);
    Ok(model.map(|m| m.thinking_levels.clone()).unwrap_or_else(|| vec!["off".into()]))
}

#[derive(Debug, serde::Deserialize)]
pub struct NewModelParams {
    pub provider: String,
    pub model_id: String,
    pub display_name: String,
    pub api_type: String,
    pub api_base_url: String,
    pub api_key: Option<String>,
    pub reasoning: bool,
    pub supports_vision: bool,
    pub context_window: u64,
    pub max_tokens: u64,
}

fn backup_file(path: &std::path::Path) -> AppResult<()> {
    if path.exists() {
        let backup = path.with_extension("json.bak");
        std::fs::copy(path, &backup)
            .map_err(|e| AppError::ConfigWriteFailed { detail: format!("Backup failed: {}", e) })?;
    }
    Ok(())
}

#[tauri::command]
pub fn add_model(app: AppHandle, params: NewModelParams) -> AppResult<()> {
    let agent_dir = get_pi_agent_dir();
    std::fs::create_dir_all(&agent_dir)
        .map_err(|e| AppError::UserDataNotAccessible { detail: format!("Cannot create ~/.pi/agent: {}", e) })?;

    // User models live in models.json (the file Pi treats as user-defined).
    // Directory models in models-store.json stay untouched.
    let models_path = agent_dir.join("models.json");
    let _ = backup_file(&models_path);

    let mut models_json: serde_json::Value = if models_path.exists() {
        let content = std::fs::read_to_string(&models_path)
            .map_err(|e| AppError::ConfigReadFailed { detail: format!("Cannot read models.json: {}", e) })?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({ "providers": {} }))
    } else {
        serde_json::json!({ "providers": {} })
    };
    if !models_json.is_object() {
        models_json = serde_json::json!({ "providers": {} });
    }
    if models_json.get_mut("providers").and_then(|p| p.as_object_mut()).is_none() {
        models_json["providers"] = serde_json::json!({});
    }

    // Full thinking map for reasoning models (all levels usable), off-only otherwise.
    // Values must be non-null: null means the level is unsupported (Pi semantics).
    let thinking_level_map = if params.reasoning {
        serde_json::json!({
            "minimal": "low",
            "low": "low",
            "medium": "medium",
            "high": "high",
            "xhigh": "max",
            "max": "max"
        })
    } else {
        serde_json::json!({ "off": "off" })
    };

    let mut input_types = vec!["text"];
    if params.supports_vision {
        input_types.push("image");
    }

    let compat = if params.api_type == "anthropic-messages" {
        serde_json::json!({ "thinkingFormat": "anthropic" })
    } else {
        serde_json::json!({ "thinkingFormat": "deepseek" })
    };

    let new_model = serde_json::json!({
        "id": params.model_id,
        "name": params.display_name,
        "api": params.api_type,
        "baseUrl": params.api_base_url,
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

    let providers = models_json["providers"].as_object_mut().unwrap();
    let provider_entry = providers
        .get(&params.provider)
        .cloned()
        .unwrap_or(serde_json::json!({ "models": [] }));
    let mut provider_obj = provider_entry.as_object().cloned().unwrap_or_default();
    let models_arr = provider_obj
        .get("models")
        .and_then(|m| m.as_array())
        .cloned()
        .unwrap_or_default();

    let mut updated_models: Vec<serde_json::Value> = models_arr
        .into_iter()
        .filter(|m| m.get("id").and_then(|v| v.as_str()) != Some(&params.model_id))
        .collect();
    updated_models.push(new_model);

    provider_obj.insert("models".into(), serde_json::Value::Array(updated_models));
    // Provider-level connection info so the model is actually usable
    provider_obj.insert("api".into(), serde_json::json!(params.api_type));
    provider_obj.insert("baseUrl".into(), serde_json::json!(params.api_base_url));
    provider_obj.insert("compat".into(), compat);
    providers.insert(params.provider.clone(), serde_json::Value::Object(provider_obj));

    let updated_json = serde_json::to_string_pretty(&models_json)
        .map_err(|e| AppError::ConfigWriteFailed { detail: format!("Serialize error: {}", e) })?;
    std::fs::write(&models_path, &updated_json)
        .map_err(|e| AppError::ConfigWriteFailed { detail: format!("Cannot write models.json: {}", e) })?;

    if let Some(ref key) = params.api_key {
        if !key.trim().is_empty() {
            let auth_path = agent_dir.join("auth.json");
            let _ = backup_file(&auth_path);

            let mut auth: serde_json::Value = if auth_path.exists() {
                let content = std::fs::read_to_string(&auth_path)
                    .map_err(|e| AppError::ConfigReadFailed { detail: format!("Cannot read auth.json: {}", e) })?;
                serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
            } else {
                serde_json::json!({})
            };

            auth[&params.provider] = serde_json::json!({
                "type": "api_key",
                "key": key,
            });

            let updated_auth = serde_json::to_string_pretty(&auth)
                .map_err(|e| AppError::ConfigWriteFailed { detail: format!("Serialize error: {}", e) })?;
            std::fs::write(&auth_path, &updated_auth)
                .map_err(|e| AppError::ConfigWriteFailed { detail: format!("Cannot write auth.json: {}", e) })?;
        }
    }

    // Broadcast so the UI can refresh the model list without a restart
    let _ = app.emit("models:changed", ());
    Ok(())
}

#[tauri::command]
pub fn remove_model(app: AppHandle, provider: String, model_id: String) -> AppResult<()> {
    let agent_dir = get_pi_agent_dir();

    // 1) Remove the user definition from models.json (user layer)
    let user_path = agent_dir.join("models.json");
    if user_path.exists() {
        let _ = backup_file(&user_path);
        let content = std::fs::read_to_string(&user_path)
            .map_err(|e| AppError::ConfigReadFailed { detail: format!("Cannot read models.json: {}", e) })?;
        let mut user: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| AppError::ConfigReadFailed { detail: format!("Invalid JSON in models.json: {}", e) })?;
        if let Some(providers) = user.get_mut("providers").and_then(|p| p.as_object_mut()) {
            if let Some(provider_obj) = providers.get_mut(&provider) {
                if let Some(models) = provider_obj.get_mut("models") {
                    if let Some(arr) = models.as_array_mut() {
                        arr.retain(|m| m.get("id").and_then(|v| v.as_str()) != Some(&model_id));
                    }
                }
                if provider_obj.get("models").and_then(|m| m.as_array()).map(|a| a.is_empty()).unwrap_or(false) {
                    providers.remove(&provider);
                }
            }
        }
        let updated = serde_json::to_string_pretty(&user)
            .map_err(|e| AppError::ConfigWriteFailed { detail: format!("Serialize error: {}", e) })?;
        std::fs::write(&user_path, &updated)
            .map_err(|e| AppError::ConfigWriteFailed { detail: format!("Cannot write models.json: {}", e) })?;
    }

    // 2) Also drop directory-catalog copies (idempotent; keeps the UI list accurate)
    let store_path = agent_dir.join("models-store.json");
    if store_path.exists() {
        let _ = backup_file(&store_path);
        let content = std::fs::read_to_string(&store_path)
            .map_err(|e| AppError::ConfigReadFailed { detail: format!("Cannot read models-store.json: {}", e) })?;
        let mut store: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| AppError::ConfigReadFailed { detail: format!("Invalid JSON in models-store.json: {}", e) })?;
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
            .map_err(|e| AppError::ConfigWriteFailed { detail: format!("Serialize error: {}", e) })?;
        std::fs::write(&store_path, &updated)
            .map_err(|e| AppError::ConfigWriteFailed { detail: format!("Cannot write models-store.json: {}", e) })?;
    }

    // Broadcast so the UI can refresh the model list without a restart
    let _ = app.emit("models:changed", ());
    Ok(())
}
