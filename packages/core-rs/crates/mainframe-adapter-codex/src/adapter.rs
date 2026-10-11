use mainframe_types::sync::LockExt as _;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use mainframe_adapter_api::{
    Adapter, AdapterError, AdapterSession, BoxFuture, ForkPinError, ForkPinRequest,
};
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_runtime::ResolvedPath;
use mainframe_types::adapter::{
    AdapterCapabilities, AdapterModel, ExternalSessionPage, ForkSource, SessionOptions,
};
use mainframe_types::display::ToolCategories;
use mainframe_types::transcript::TranscriptLocation;

use crate::context_window::catalog_context_window;
use crate::external_sessions::list_external_sessions;
use crate::fork::{fork_supported, fork_unavailable_reason_for};
use crate::fork_pin::pin_fork_point;
use crate::plan_mode_handler::CodexPlanModeHandler;
use crate::session::{CodexSession, spawn_temp_app_server};
use crate::title_generator::generate_codex_title;
use crate::transcript::locate_codex_transcript;
use crate::types::{ModelInfo, ModelListResult};

pub fn map_codex_model(m: &ModelInfo) -> AdapterModel {
    let mut model = AdapterModel {
        id: m.id.clone(),
        label: m.display_name.clone().unwrap_or_else(|| m.id.clone()),
        description: None,
        resolved_model: None,
        context_window: Some(catalog_context_window(&m.id)),
        is_default: None,
        is_older: None,
        group: None,
        supported_efforts: None,
        default_effort: None,
        supports_fast: None,
        supports_ultracode: None,
        supports_adaptive_thinking: None,
        supports_personality: None,
    };
    if let Some(desc) = &m.description {
        model.description = Some(desc.clone());
    }
    if m.is_default == Some(true) {
        model.is_default = Some(true);
    }
    if let Some(efforts) = &m.supported_reasoning_efforts
        && !efforts.is_empty()
    {
        model.supported_efforts = Some(efforts.iter().map(|e| e.reasoning_effort).collect());
    }
    if let Some(default_effort) = m.default_reasoning_effort {
        model.default_effort = Some(default_effort);
    }
    if m.additional_speed_tiers
        .as_ref()
        .map(|t| t.iter().any(|s| s == "fast"))
        .unwrap_or(false)
    {
        model.supports_fast = Some(true);
    }
    if m.supports_personality == Some(true) {
        model.supports_personality = Some(true);
    }
    model
}

pub struct CodexAdapter {
    sessions: Arc<Mutex<Vec<Arc<CodexSession>>>>,
    /// Model catalog is static per session; cache it so resolution doesn't respawn
    /// a temp app-server each time.
    cached_models: Arc<Mutex<Option<Vec<AdapterModel>>>>,
    /// Boot-resolved login-shell `PATH`, applied to every spawned `codex` CLI so
    /// packaged builds find it outside the bare launchd `PATH`.
    resolved_path: ResolvedPath,
    /// Shared with every other adapter so a Codex sub-agent's
    /// activity row lands in the same chat-scoped live set a Claude sub-agent's
    /// does.
    background_tasks: Arc<BackgroundTaskTracker>,
    /// The CLI version the registry's last successful refresh observed —
    /// `AdapterRegistry::run_refresh` reports it via `observe_cli_version` before
    /// calling the synchronous `capabilities()`. `None` before the first
    /// refresh, or when the version could not be determined; `capabilities().fork`
    /// is `false` in both cases.
    observed_version: Arc<Mutex<Option<String>>>,
    /// Test seam only — `pin_fork_point`'s temp-app-server
    /// executable. `"codex"` in production; see `CodexSession::
    /// history_executable`'s doc comment for why bare-name PATH resolution
    /// can't be overridden from a test.
    pin_executable: Arc<Mutex<String>>,
}

impl Default for CodexAdapter {
    fn default() -> Self {
        Self::new(
            Arc::new(BackgroundTaskTracker::new()),
            ResolvedPath::from_value("/usr/bin:/bin"),
        )
    }
}

impl CodexAdapter {
    pub fn new(background_tasks: Arc<BackgroundTaskTracker>, resolved_path: ResolvedPath) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(Vec::new())),
            cached_models: Arc::new(Mutex::new(None)),
            resolved_path,
            background_tasks,
            observed_version: Arc::new(Mutex::new(None)),
            pin_executable: Arc::new(Mutex::new("codex".to_string())),
        }
    }

    /// Test-only override for `pin_fork_point`'s temp-app-server executable — see
    /// the field doc comment.
    pub fn set_pin_executable(&self, executable: &str) {
        *self.pin_executable.lock_recover() = executable.to_string();
    }

    pub fn create_plan_mode_handler(&self) -> CodexPlanModeHandler {
        CodexPlanModeHandler::new()
    }

    /// Codex sessions are imported by scanning rollout JSONL on disk (#430), so this
    /// delegates to the disk scanner instead of the removed `thread/list` RPC.
    pub async fn list_external_sessions(
        &self,
        project_path: &str,
        exclude_session_ids: &[String],
        offset: Option<usize>,
        limit: Option<usize>,
    ) -> ExternalSessionPage {
        list_external_sessions(project_path, exclude_session_ids, offset, limit, None).await
    }

    async fn load_models(&self, executable: &str) -> Vec<AdapterModel> {
        if let Some(cached) = self.cached_models.lock_recover().clone() {
            return cached;
        }
        let client =
            match spawn_temp_app_server(executable, None, false, self.resolved_path.as_str()).await
            {
                Ok(c) => c,
                Err(err) => {
                    tracing::warn!(error = %err, "failed to list models");
                    return Vec::new();
                }
            };
        let models: Vec<AdapterModel> = match client.request("model/list", None).await {
            Ok(v) => match serde_json::from_value::<ModelListResult>(v) {
                Ok(result) => result
                    .data
                    .iter()
                    .filter(|m| m.hidden != Some(true))
                    .map(map_codex_model)
                    .collect(),
                Err(err) => {
                    tracing::warn!(error = %err, "failed to list models");
                    Vec::new()
                }
            },
            Err(err) => {
                tracing::warn!(error = %err.0, "failed to list models");
                Vec::new()
            }
        };
        client.close();
        // Don't cache transient failures (empty).
        if !models.is_empty() {
            *self.cached_models.lock_recover() = Some(models.clone());
        }
        models
    }
}

mod contract;

#[cfg(test)]
#[path = "adapter_tests.rs"]
mod tests;
