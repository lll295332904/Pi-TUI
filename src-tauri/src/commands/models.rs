use crate::error::{AppError, AppResult};
use serde::Serialize;

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

fn sync_models_json() -> AppResult<()> {
    let agent_dir = get_pi_agent_dir();
    let store_path = agent_dir.join("models-store.json");
    let models_json_path = agent_dir.join("models.json");

    if !store_path.exists() {
        return Ok(());
    }
    let store: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(&store_path)
            .map_err(|e| AppError::ConfigReadFailed { detail: format!("Cannot read models-store.json: {}", e) })?, 
    )
    .map_err(|e| AppError::ConfigReadFailed { detail: format!("Invalid models-store.json: {}", e) })?;

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
    if models_json.get_mut("providers").and_then(|p| p.as_object_mut()).is_none() {
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
        .map_err(|e| AppError::ConfigWriteFailed { detail: format!("Serialize models.json error: {}", e) })?;
    std::fs::write(&models_json_path, updated)
        .map_err(|e| AppError::ConfigWriteFailed { detail: format!("Cannot write models.json: {}", e) })?;
    Ok(())
}

#[tauri::command]
pub fn get_available_models() -> AppResult<Vec<AvailableModel>> {
    let _ = sync_models_json();

    let models_store = get_pi_agent_dir().join("models-store.json");
    if !models_store.exists() {
        return Ok(vec![]);
    }

    let content = std::fs::read_to_string(&models_store)
        .map_err(|e| AppError::ConfigReadFailed { detail: format!("Cannot read models-store.json: {}", e) })?;
    let json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| AppError::ConfigReadFailed { detail: format!("Invalid JSON in models-store.json: {}", e) })?;

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

                    let mut thinking_levels = Vec::new();
                    if let Some(tlm) = model.get("thinkingLevelMap").and_then(|v| v.as_object()) {
                        for level in ["off", "minimal", "low", "medium", "high", "xhigh", "max"] {
                            if tlm.contains_key(level) {
                                thinking_levels.push(level.to_string());
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
pub fn add_model(params: NewModelParams) -> AppResult<()> {
    let agent_dir = get_pi_agent_dir();
    std::fs::create_dir_all(&agent_dir)
        .map_err(|e| AppError::UserDataNotAccessible { detail: format!("Cannot create ~/.pi/agent: {}", e) })?;

    let models_path = agent_dir.join("models-store.json");
    let _ = backup_file(&models_path);

    let mut models_store: serde_json::Value = if models_path.exists() {
        let content = std::fs::read_to_string(&models_path)
            .map_err(|e| AppError::ConfigReadFailed { detail: format!("Cannot read models-store.json: {}", e) })?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

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

    let provider_entry = models_store
        .get_mut(&params.provider)
        .cloned()
        .unwrap_or(serde_json::json!({
            "models": [],
            "checkedAt": null,
            "lastModified": null
        }));

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
    models_store[&params.provider] = serde_json::Value::Object(provider_obj);

    let updated_json = serde_json::to_string_pretty(&models_store)
        .map_err(|e| AppError::ConfigWriteFailed { detail: format!("Serialize error: {}", e) })?;
    std::fs::write(&models_path, &updated_json)
        .map_err(|e| AppError::ConfigWriteFailed { detail: format!("Cannot write models-store.json: {}", e) })?;

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

    let _ = sync_models_json();
    Ok(())
}

#[tauri::command]
pub fn remove_model(provider: String, model_id: String) -> AppResult<()> {
    let models_path = get_pi_agent_dir().join("models-store.json");
    if models_path.exists() {
        let _ = std::fs::copy(&models_path, models_path.with_extension("json.bak"));
    }
    let content = std::fs::read_to_string(&models_path)
        .map_err(|e| AppError::ConfigReadFailed { detail: format!("Cannot read: {}", e) })?;
    let mut store: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| AppError::ConfigReadFailed { detail: format!("Invalid JSON: {}", e) })?;
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
    std::fs::write(&models_path, &updated)
        .map_err(|e| AppError::ConfigWriteFailed { detail: format!("Cannot write: {}", e) })?;

    let _ = sync_models_json();
    Ok(())
}
