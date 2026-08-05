//! Everything that knows a local [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)
//! might exist. It wraps OAuth'd CLI subscriptions (Codex/ChatGPT, Kimi, …) behind an
//! Anthropic-compatible endpoint, so the same `claude` binary reaches them once
//! `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` point at it.
//!
//! Absence is the expected steady state: every discovery path returns `None` rather
//! than an error. The one loud failure is [`resolve_env`], reached only after the user
//! explicitly picked a proxy model.
//!
//! The proxy's API key is read from the proxy's own config at spawn and never copied
//! into Mainframe's DB, the OS keyring, or any serializable payload — hence the manual
//! `Debug` impls below.

use std::time::Duration;

use mainframe_types::adapter::AdapterModel;

mod config;
mod label;
mod order;

pub use config::discover;

/// Namespace prefix on every proxy model id (`cliproxy/gpt-5.6-sol`). Load-bearing:
/// it is how the spawn path decides to apply env, how the picker groups, and how a
/// stored `chat.model` stays unambiguous after the proxy disappears.
pub const ENDPOINT_ID: &str = "cliproxy";
/// Picker section label.
pub const GROUP_LABEL: &str = "CLIProxyAPI";

const FETCH_TIMEOUT: Duration = Duration::from_secs(5);

/// Candidates for the CLI's small/fast model, best first. An explicit preference
/// list, not a name heuristic — the proxy rejects `claude-haiku-*` outright, so
/// *something* has to stand in for every background call the CLI makes.
const SMALL_FAST_PREFERENCES: &[&str] = &[
    "gpt-5.4-mini",
    "gpt-5.3-codex-spark",
    "kimi-k2.7-code-highspeed",
];

#[derive(Clone, PartialEq, Eq)]
pub struct CliProxyConfig {
    pub base_url: String,
    pub auth_token: String,
}

impl std::fmt::Debug for CliProxyConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CliProxyConfig")
            .field("base_url", &self.base_url)
            .field("auth_token", &"<redacted>")
            .finish()
    }
}

/// One entry of `GET /v1/models`. The proxy publishes no context window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProxyModel {
    pub id: String,
    pub owned_by: Option<String>,
}

/// Everything the spawn path needs to point a `claude` child at the proxy.
#[derive(Clone, PartialEq, Eq)]
pub struct CliProxyEnv {
    pub base_url: String,
    pub auth_token: String,
    pub small_fast_model: String,
}

impl std::fmt::Debug for CliProxyEnv {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CliProxyEnv")
            .field("base_url", &self.base_url)
            .field("auth_token", &"<redacted>")
            .field("small_fast_model", &self.small_fast_model)
            .finish()
    }
}

/// Split a stored model id into its endpoint and the bare id the CLI's `--model` wants.
/// Native ids pass through untouched.
pub fn split_endpoint(model: &str) -> (Option<&str>, &str) {
    match mainframe_types::adapter::model_endpoint(model) {
        Some(ENDPOINT_ID) => (Some(ENDPOINT_ID), &model[ENDPOINT_ID.len() + 1..]),
        _ => (None, model),
    }
}

pub fn namespaced(bare_id: &str) -> String {
    format!("{ENDPOINT_ID}/{bare_id}")
}

/// `gpt-image-1.5`, `gpt-image-2` — listed by the proxy but not chat models.
fn is_image_model(id: &str) -> bool {
    id.contains("-image-") || id.starts_with("image-") || id.ends_with("-image")
}

/// The proxy's chat catalog, or `None` on any transport or non-200 result — which is
/// also how "installed but not running" reads.
pub async fn fetch_models(config: &CliProxyConfig) -> Option<Vec<ProxyModel>> {
    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .build()
        .ok()?;
    let response = client
        .get(format!("{}/v1/models", config.base_url))
        .bearer_auth(&config.auth_token)
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        tracing::debug!(status = %response.status(), "cliproxy: /v1/models rejected");
        return None;
    }
    let body: serde_json::Value = response.json().await.ok()?;
    Some(
        body.get("data")?
            .as_array()?
            .iter()
            .filter_map(|entry| {
                let id = entry.get("id")?.as_str()?.to_string();
                (!is_image_model(&id)).then(|| ProxyModel {
                    owned_by: entry
                        .get("owned_by")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_string),
                    id,
                })
            })
            .collect(),
    )
}

/// Present the proxy catalog as picker entries, strongest model first. Everything
/// Anthropic-specific stays `None`: the proxy publishes no context window, and the CLI's
/// effort/fast/thinking flags are Claude capabilities that the models behind the proxy do
/// not honour — so the tuning controls hide themselves rather than sending flags into the void.
pub fn to_adapter_models(catalog: &[ProxyModel]) -> Vec<AdapterModel> {
    order::by_capability(catalog)
        .into_iter()
        .map(|model| {
            let owner = model.owned_by.as_deref();
            AdapterModel {
                id: namespaced(&model.id),
                label: label::display_label(&model.id, owner),
                description: Some(label::display_description(&model.id, owner)),
                group: Some(GROUP_LABEL.to_string()),
                resolved_model: None,
                context_window: None,
                is_default: None,
                is_older: None,
                supported_efforts: None,
                default_effort: None,
                supports_fast: None,
                supports_ultracode: None,
                supports_adaptive_thinking: None,
                supports_personality: None,
            }
        })
        .collect()
}

/// The proxy section of the model picker, or empty when no proxy is installed or
/// running. Never errors — a missing proxy is the common case, not a fault.
pub async fn probe_catalog() -> Vec<AdapterModel> {
    let Some(config) = discover(None).await else {
        return Vec::new();
    };
    let Some(catalog) = fetch_models(&config).await else {
        tracing::debug!("cliproxy: config found but the proxy did not answer");
        return Vec::new();
    };
    to_adapter_models(&catalog)
}

/// The setting if set, else the best preference the proxy actually serves, else the
/// selected model itself — the CLI needs *some* small/fast model it can reach.
pub fn pick_small_fast_model(
    catalog: &[ProxyModel],
    override_model: Option<&str>,
    selected: &str,
) -> String {
    if let Some(model) = override_model.map(str::trim).filter(|m| !m.is_empty()) {
        return model.to_string();
    }
    SMALL_FAST_PREFERENCES
        .iter()
        .find(|candidate| catalog.iter().any(|m| m.id == **candidate))
        .map(|candidate| candidate.to_string())
        .unwrap_or_else(|| selected.to_string())
}

/// Resolve the spawn env for a chat pinned to a proxy model. Unlike the rest of this
/// module this one is loud: the user explicitly chose a proxy model, so silence would
/// strand them on a session that never answers.
pub async fn resolve_env(
    config_path_override: Option<&str>,
    small_fast_override: Option<&str>,
    selected_model: &str,
) -> Result<CliProxyEnv, String> {
    const UNREACHABLE: &str = "CLIProxyAPI is not reachable — start it with `brew services start cliproxyapi`, or pick a Claude model.";

    let config = discover(config_path_override).await.ok_or(UNREACHABLE)?;
    let catalog = fetch_models(&config).await.ok_or(UNREACHABLE)?;
    Ok(CliProxyEnv {
        small_fast_model: pick_small_fast_model(&catalog, small_fast_override, selected_model),
        base_url: config.base_url,
        auth_token: config.auth_token,
    })
}

#[cfg(test)]
mod tests;
