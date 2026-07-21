//! Ported from `packages/core/src/plugins/builtin/codex/adapter.ts`.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use mainframe_adapter_api::{Adapter, AdapterError, AdapterSession, BoxFuture};
use mainframe_runtime::ResolvedPath;
use mainframe_types::adapter::{
    AdapterCapabilities, AdapterModel, ExternalSessionPage, SessionOptions,
};
use mainframe_types::display::ToolCategories;

use crate::external_sessions::list_external_sessions;
use crate::plan_mode_handler::CodexPlanModeHandler;
use crate::session::{CodexSession, spawn_temp_app_server};
use crate::transcript::is_codex_transcript_present;
use crate::types::{ModelInfo, ModelListResult};

pub fn map_codex_model(m: &ModelInfo) -> AdapterModel {
    let mut model = AdapterModel {
        id: m.id.clone(),
        label: m.display_name.clone().unwrap_or_else(|| m.id.clone()),
        description: None,
        resolved_model: None,
        context_window: None,
        is_default: None,
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
    /// a temp app-server each time (CONCURRENCY.tsv 104).
    cached_models: Arc<Mutex<Option<Vec<AdapterModel>>>>,
    /// Boot-resolved login-shell `PATH`, applied to every spawned `codex` CLI so
    /// packaged builds find it outside the bare launchd `PATH` (mirrors the TS
    /// `enrichPath` env mutation).
    resolved_path: ResolvedPath,
}

impl Default for CodexAdapter {
    fn default() -> Self {
        Self::new(ResolvedPath::from_value("/usr/bin:/bin"))
    }
}

impl CodexAdapter {
    pub fn new(resolved_path: ResolvedPath) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(Vec::new())),
            cached_models: Arc::new(Mutex::new(None)),
            resolved_path,
        }
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
        if let Some(cached) = self
            .cached_models
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
        {
            return cached;
        }
        let client = match spawn_temp_app_server(
            executable,
            None,
            false,
            self.resolved_path.as_str(),
        )
        .await
        {
            Ok(c) => c,
            Err(err) => {
                tracing::warn!(module = "codex:adapter", err = %err, "codex: failed to list models");
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
                    tracing::warn!(module = "codex:adapter", err = %err, "codex: failed to list models");
                    Vec::new()
                }
            },
            Err(err) => {
                tracing::warn!(module = "codex:adapter", err = %err.0, "codex: failed to list models");
                Vec::new()
            }
        };
        client.close();
        // Don't cache transient failures (empty).
        if !models.is_empty() {
            *self.cached_models.lock().unwrap_or_else(|e| e.into_inner()) = Some(models.clone());
        }
        models
    }
}

impl Adapter for CodexAdapter {
    fn id(&self) -> &str {
        "codex"
    }
    fn name(&self) -> &str {
        "Codex"
    }
    fn capabilities(&self) -> AdapterCapabilities {
        AdapterCapabilities { plan_mode: true }
    }

    fn is_installed(&self) -> BoxFuture<'_, Result<bool, AdapterError>> {
        let path = self.resolved_path.clone();
        Box::pin(async move {
            match tokio::process::Command::new("codex")
                .arg("--version")
                .env("PATH", path.as_str())
                .output()
                .await
            {
                Ok(out) => Ok(out.status.success()),
                Err(_) => Ok(false),
            }
        })
    }

    fn get_version(&self) -> BoxFuture<'_, Result<Option<String>, AdapterError>> {
        let path = self.resolved_path.clone();
        Box::pin(async move {
            match tokio::process::Command::new("codex")
                .arg("--version")
                .env("PATH", path.as_str())
                .output()
                .await
            {
                Ok(out) if out.status.success() => {
                    let stdout = String::from_utf8_lossy(&out.stdout);
                    Ok(Some(
                        parse_version(&stdout).unwrap_or_else(|| stdout.trim().to_string()),
                    ))
                }
                _ => Ok(None),
            }
        })
    }

    fn get_fallback_models(&self) -> Option<Vec<AdapterModel>> {
        Some(Vec::new())
    }

    fn list_models(&self) -> BoxFuture<'_, Result<Vec<AdapterModel>, AdapterError>> {
        Box::pin(async move { Ok(self.load_models("codex").await) })
    }

    fn has_probe_models(&self) -> bool {
        true
    }

    /// `probeModels(executablePath?)` — probe with the configured Codex binary
    /// (#430). Delegates to `load_models`, which caches non-empty catalogs.
    fn probe_models(
        &self,
        executable_path: Option<String>,
    ) -> BoxFuture<'_, Result<Option<Vec<AdapterModel>>, AdapterError>> {
        Box::pin(async move {
            let exe = executable_path.unwrap_or_else(|| "codex".to_string());
            Ok(Some(self.load_models(&exe).await))
        })
    }

    /// `isTranscriptPresent(sessionId)` — Codex resolves presence from its state DB
    /// via the thread registry, so `project_path`/`session_file_path` are unused.
    fn is_transcript_present(
        &self,
        session_id: String,
        _project_path: String,
        _session_file_path: Option<String>,
    ) -> BoxFuture<'_, Result<Option<bool>, AdapterError>> {
        Box::pin(async move { Ok(is_codex_transcript_present(&session_id, None).await) })
    }

    fn get_tool_categories(&self) -> Option<ToolCategories> {
        Some(ToolCategories {
            explore: HashSet::new(),
            // Codex todoList items — hidden from chat; Context tab TasksSection handles them.
            hidden: HashSet::from(["todo_list".to_string()]),
            // declared for parity; redundant once hidden filter fires.
            progress: HashSet::from(["todo_list".to_string()]),
            subagent: HashSet::from(["CollabAgent".to_string()]),
        })
    }

    fn create_session(&self, options: SessionOptions) -> Arc<dyn AdapterSession> {
        let session = Arc::new(CodexSession::new(options, None, self.resolved_path.clone()));
        let sessions = self.sessions.clone();
        let id = session.id().to_string();
        session.set_on_exit(Box::new(move || {
            sessions
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .retain(|s| s.id() != id);
        }));
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(session.clone());
        session
    }

    fn kill_all(&self) {
        let drained: Vec<Arc<CodexSession>> = self
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .drain(..)
            .collect();
        for session in drained {
            tokio::spawn(async move {
                if let Err(err) = session.kill().await {
                    tracing::warn!(module = "codex:adapter", err = %err, "failed to kill codex session during killAll");
                }
            });
        }
    }
}

/// The first `N.N.N` triple in `stdout` (mirrors the TS `stdout.match(/(\d+\.\d+\.\d+)/)`).
fn parse_version(stdout: &str) -> Option<String> {
    let b = stdout.as_bytes();
    let n = b.len();
    let mut i = 0;
    while i < n {
        if b[i].is_ascii_digit() {
            let mut j = i;
            while j < n && b[j].is_ascii_digit() {
                j += 1;
            }
            if j < n && b[j] == b'.' {
                j += 1;
                let g2 = j;
                while j < n && b[j].is_ascii_digit() {
                    j += 1;
                }
                if j > g2 && j < n && b[j] == b'.' {
                    j += 1;
                    let g3 = j;
                    while j < n && b[j].is_ascii_digit() {
                        j += 1;
                    }
                    if j > g3 {
                        return Some(stdout[i..j].to_string());
                    }
                }
            }
        }
        i += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::ReasoningEffortOption;
    use mainframe_types::adapter::EffortLevel;

    // --- list-models.test.ts ---
    #[test]
    fn maps_efforts_default_fast_tier_personality_is_default() {
        let m = ModelInfo {
            id: "gpt-5.5".to_string(),
            display_name: Some("GPT-5.5".to_string()),
            description: Some("Frontier".to_string()),
            hidden: Some(false),
            is_default: Some(false),
            supports_personality: Some(true),
            additional_speed_tiers: Some(vec!["fast".to_string()]),
            default_reasoning_effort: Some(EffortLevel::Medium),
            supported_reasoning_efforts: Some(vec![
                ReasoningEffortOption {
                    reasoning_effort: EffortLevel::Low,
                    description: String::new(),
                },
                ReasoningEffortOption {
                    reasoning_effort: EffortLevel::Medium,
                    description: String::new(),
                },
                ReasoningEffortOption {
                    reasoning_effort: EffortLevel::High,
                    description: String::new(),
                },
                ReasoningEffortOption {
                    reasoning_effort: EffortLevel::Xhigh,
                    description: String::new(),
                },
            ]),
        };
        let model = map_codex_model(&m);
        assert_eq!(
            model.supported_efforts,
            Some(vec![
                EffortLevel::Low,
                EffortLevel::Medium,
                EffortLevel::High,
                EffortLevel::Xhigh
            ])
        );
        assert_eq!(model.default_effort, Some(EffortLevel::Medium));
        assert_eq!(model.supports_fast, Some(true));
        assert_eq!(model.supports_personality, Some(true));
    }

    #[test]
    fn deserializes_model_list_with_ultra_reasoning_effort() {
        let payload = serde_json::json!({
            "data": [{
                "id": "gpt-6-codex",
                "displayName": "GPT-6 Codex",
                "defaultReasoningEffort": "ultra",
                "supportedReasoningEfforts": [
                    { "reasoningEffort": "high", "description": "" },
                    { "reasoningEffort": "ultra", "description": "" }
                ]
            }]
        });
        let result: ModelListResult =
            serde_json::from_value(payload).expect("ultra reasoning effort must deserialize");
        let model = map_codex_model(&result.data[0]);
        assert_eq!(model.id, "gpt-6-codex");
        assert_eq!(model.default_effort, Some(EffortLevel::Ultra));
        assert_eq!(
            model.supported_efforts,
            Some(vec![EffortLevel::High, EffortLevel::Ultra])
        );
    }
}

// PORT STATUS: src/plugins/builtin/codex/adapter.ts (160 lines)
// confidence: medium
// todos: 0
// notes: #430 — listExternalSessions delegates to the disk scanner (external_sessions.rs;
// notes: thread/list RPC + ThreadListResult removed). loadModels(executable) extracted;
// notes: listModels → load_models("codex"), probeModels(exe) → load_models(exe??"codex").
// notes: spawn_temp_app_server now takes the executable (probe uses the configured path).
// notes: has_probe_models()=true + probe_models/is_transcript_present are Adapter-trait
// notes: overrides (so the registry dispatch in adapter-api probes Codex with the
// notes: configured binary, mirroring `typeof adapter.probeModels === 'function'`).
// notes: list_external_sessions/create_plan_mode_handler stay inherent (the trait defers
// notes: external-session CRUD + createPlanModeHandler — adapter-api's own TODO(port)).
// notes: sessions = Arc<Mutex<Vec<Arc<CodexSession>>>> (CONCURRENCY.tsv 103; Vec + id
// notes: retain instead of a HashSet since Arc<CodexSession> isn't Hash), cachedModels
// notes: Arc<Mutex<Option<..>>> (104). killAll spawns a kill task per session (TS
// notes: fire-and-forget .catch). is_installed/get_version shell out to `codex
// notes: --version`; parse_version mirrors adapter-api's hand-rolled N.N.N scan.
// notes: get_fallback_models returns Some(vec![]) (TS returns []). mapCodexModel test
// notes: ported inline; the probeModels-with-configured-path test lives in
// notes: tests/list_models.rs (fake app-server). index.ts `activate` re-exported from lib.rs.
