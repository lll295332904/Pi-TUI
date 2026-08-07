use crate::error::{AppError, AppResult};
use crate::AppState;
use tauri::State;

#[derive(Debug, serde::Serialize)]
pub struct FetchedModel {
    pub id: String,
    pub owned_by: Option<String>,
}

#[tauri::command]
pub async fn fetch_models_from_url(
    base_url: String,
    api_key: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<Vec<FetchedModel>> {
    state.logger.info(&format!("Provider model discovery started: {}", base_url));
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

    let resp = req.send().await.map_err(|e| {
        state.logger.error(&format!("Provider model discovery request failed: {}", e));
        AppError::ProviderNetworkFailed { detail: e.to_string() }
    })?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| AppError::ProviderNetworkFailed { detail: format!("Failed to read response body: {}", e) })?;

    if !status.is_success() {
        let snippet = if text.len() > 500 { &text[..500] } else { &text };
        let detail = format!("HTTP {} from {}: {}", status.as_u16(), url, snippet);
        state.logger.warn(&format!("Provider model discovery returned HTTP {}", status.as_u16()));
        return Err(if status.as_u16() == 401 || status.as_u16() == 403 {
            AppError::ProviderAuthFailed { detail }
        } else {
            AppError::ProviderNetworkFailed { detail }
        }.into());
    }

    let body: serde_json::Value = serde_json::from_str(&text).map_err(|e| {
        let snippet = if text.len() > 500 { &text[..500] } else { &text };
        AppError::ProviderNetworkFailed { detail: format!("JSON parse failed: {} - response body: {}", e, snippet) }
    })?;

    let data = body.get("data")
        .and_then(|d| d.as_array())
        .ok_or_else(|| AppError::ProviderNetworkFailed { detail: "Response missing 'data' array".into() })?;

    let models: Vec<FetchedModel> = data.iter()
        .filter_map(|item| {
            Some(FetchedModel {
                id: item.get("id")?.as_str()?.to_string(),
                owned_by: item.get("owned_by").and_then(|v| v.as_str()).map(String::from),
            })
        })
        .collect();

    state.logger.info(&format!("Provider model discovery completed: {} models", models.len()));
    Ok(models)
}
