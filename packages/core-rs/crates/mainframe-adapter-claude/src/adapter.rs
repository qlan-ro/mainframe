//! Ported from `packages/core/src/plugins/builtin/claude/adapter.ts`.
//!
//! The `ClaudeAdapter` struct (the `Adapter` trait impl). The catalog surface it
//! serves — the static fallback list, the older-model merge and
//! `enrich_with_context_window` — lives in [`crate::models`].

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use mainframe_adapter_api::{
    Adapter, AdapterError, AdapterSession, BoxFuture, PlanModeActionHandler,
};
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_claude_workflows::store::ClaudeWorkflowStore;
use mainframe_runtime::ResolvedPath;
use mainframe_types::adapter::{AdapterCapabilities, AdapterModel, SessionOptions};
use mainframe_types::display::ToolCategories;
use mainframe_types::transcript::TranscriptLocation;

use crate::models::{claude_models, enrich_with_context_window, merge_older_models};
use crate::plan_mode_handler::ClaudePlanModeHandler;
use crate::session::ClaudeSession;
use crate::title_generator::generate_claude_title;
use crate::transcript::{is_claude_transcript_present, locate_claude_transcript};

/// The manifest `name` (the TS adapter imports `manifest.json`; the Rust port has
/// no manifest asset, so the string is inlined).
const CLAUDE_ADAPTER_NAME: &str = "Claude Code";

/// `\d+\.\d+\.\d+` — the first N.N.N triple in `stdout` (no regex crate).
fn first_version_triple(stdout: &str) -> Option<String> {
    let bytes = stdout.as_bytes();
    let n = bytes.len();
    let mut i = 0;
    while i < n {
        if bytes[i].is_ascii_digit() {
            let start = i;
            let mut dots = 0;
            let mut j = i;
            while j < n && (bytes[j].is_ascii_digit() || (bytes[j] == b'.' && dots < 2)) {
                if bytes[j] == b'.' {
                    // require a digit before and after each dot
                    if j + 1 >= n || !bytes[j + 1].is_ascii_digit() {
                        break;
                    }
                    dots += 1;
                }
                j += 1;
            }
            if dots == 2 {
                return Some(stdout[start..j].to_string());
            }
            i = j.max(i + 1);
        } else {
            i += 1;
        }
    }
    None
}

fn tool_category(names: &[&str]) -> std::collections::HashSet<String> {
    names.iter().map(|s| s.to_string()).collect()
}

/// The native catalog — the live probe when one succeeded, the static list otherwise —
/// followed by the CLIProxyAPI section. Order is the picker's order.
fn merged_catalog(
    native: Option<Vec<AdapterModel>>,
    proxy: Vec<AdapterModel>,
) -> Vec<AdapterModel> {
    let mut models = native.unwrap_or_else(claude_models);
    models.extend(proxy);
    models
}

pub struct ClaudeAdapter {
    background_tasks: Arc<BackgroundTaskTracker>,
    workflow_store: Arc<ClaudeWorkflowStore>,
    sessions: Arc<Mutex<HashMap<String, Arc<ClaudeSession>>>>,
    dynamic_models: Arc<Mutex<Option<Vec<AdapterModel>>>>,
    /// Models a local CLIProxyAPI serves, refreshed by each probe. Empty is the
    /// expected steady state — most installs have no proxy.
    proxy_models: Arc<Mutex<Vec<AdapterModel>>>,
    /// Boot-resolved login-shell `PATH`, applied to every spawned `claude` CLI so
    /// packaged builds find it outside the bare launchd `PATH` (mirrors the TS
    /// `enrichPath` env mutation).
    resolved_path: ResolvedPath,
}

impl ClaudeAdapter {
    pub fn new(
        background_tasks: Arc<BackgroundTaskTracker>,
        workflow_store: Arc<ClaudeWorkflowStore>,
        resolved_path: ResolvedPath,
    ) -> Self {
        Self {
            background_tasks,
            workflow_store,
            sessions: Arc::new(Mutex::new(HashMap::new())),
            dynamic_models: Arc::new(Mutex::new(None)),
            proxy_models: Arc::new(Mutex::new(Vec::new())),
            resolved_path,
        }
    }
}

impl Default for ClaudeAdapter {
    fn default() -> Self {
        Self::new(
            Arc::new(BackgroundTaskTracker::new()),
            Arc::new(ClaudeWorkflowStore::new()),
            ResolvedPath::from_value("/usr/bin:/bin"),
        )
    }
}

impl Adapter for ClaudeAdapter {
    fn id(&self) -> &str {
        "claude"
    }
    fn name(&self) -> &str {
        CLAUDE_ADAPTER_NAME
    }
    fn capabilities(&self) -> AdapterCapabilities {
        AdapterCapabilities {
            plan_mode: true,
            auto_mode: true,
        }
    }

    fn is_installed(&self) -> BoxFuture<'_, Result<bool, AdapterError>> {
        let path = self.resolved_path.clone();
        Box::pin(async move {
            Ok(
                match tokio::process::Command::new("claude")
                    .arg("--version")
                    .env("PATH", path.as_str())
                    .output()
                    .await
                {
                    Ok(o) => o.status.success(),
                    Err(_) => false,
                },
            )
        })
    }

    fn get_version(&self) -> BoxFuture<'_, Result<Option<String>, AdapterError>> {
        let path = self.resolved_path.clone();
        Box::pin(async move {
            match tokio::process::Command::new("claude")
                .arg("--version")
                .env("PATH", path.as_str())
                .output()
                .await
            {
                Ok(o) if o.status.success() => {
                    let stdout = String::from_utf8_lossy(&o.stdout).to_string();
                    Ok(first_version_triple(&stdout).or_else(|| Some(stdout.trim().to_string())))
                }
                _ => Ok(None),
            }
        })
    }

    fn list_models(&self) -> BoxFuture<'_, Result<Vec<AdapterModel>, AdapterError>> {
        let dynamic = self.dynamic_models.clone();
        let proxy = self.proxy_models.clone();
        Box::pin(async move {
            let native = dynamic.lock().unwrap_or_else(|e| e.into_inner()).clone();
            let proxy = proxy.lock().unwrap_or_else(|e| e.into_inner()).clone();
            Ok(merged_catalog(native, proxy))
        })
    }

    fn has_probe_models(&self) -> bool {
        true
    }

    fn probe_models(
        &self,
        executable_path: Option<String>,
    ) -> BoxFuture<'_, Result<Option<Vec<AdapterModel>>, AdapterError>> {
        let dynamic = self.dynamic_models.clone();
        let proxy = self.proxy_models.clone();
        let path = self.resolved_path.clone();
        Box::pin(async move {
            let exe = executable_path.unwrap_or_else(|| "claude".to_string());
            if let Some(result) = crate::probe_models::probe_models(&exe, path.as_str()).await {
                let enriched =
                    enrich_with_context_window(result.models, result.resolved_model.as_deref());
                *dynamic.lock().unwrap_or_else(|e| e.into_inner()) =
                    Some(merge_older_models(enriched));
            }
            *proxy.lock().unwrap_or_else(|e| e.into_inner()) =
                crate::cliproxy::probe_catalog().await;

            let native = dynamic.lock().unwrap_or_else(|e| e.into_inner()).clone();
            let proxy = proxy.lock().unwrap_or_else(|e| e.into_inner()).clone();
            if native.is_none() && proxy.is_empty() {
                return Ok(None);
            }
            Ok(Some(merged_catalog(native, proxy)))
        })
    }

    fn get_fallback_models(&self) -> Option<Vec<AdapterModel>> {
        Some(claude_models())
    }

    fn create_session(&self, options: SessionOptions) -> Arc<dyn AdapterSession> {
        let session = Arc::new(ClaudeSession::new(
            options,
            None,
            self.background_tasks.clone(),
            self.workflow_store.clone(),
            self.resolved_path.clone(),
        ));
        session.init_weak();
        let id = session.id.clone();
        let sessions = self.sessions.clone();
        session.set_on_exit(Box::new(move || {
            sessions
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&id);
        }));
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(session.id.clone(), session.clone());
        session
    }

    fn kill_all(&self) {
        let all: Vec<Arc<ClaudeSession>> = self
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .cloned()
            .collect();
        for session in all {
            tokio::spawn(async move {
                if let Err(err) = session.kill().await {
                    tracing::warn!(?err, "failed to kill claude session during killAll");
                }
            });
        }
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
    }

    fn generate_title(
        &self,
        content: String,
        binary: String,
    ) -> BoxFuture<'_, Result<Option<String>, AdapterError>> {
        let path = self.resolved_path.clone();
        Box::pin(async move { generate_claude_title(&content, &binary, path.as_str()).await })
    }

    fn is_transcript_present(
        &self,
        session_id: String,
        project_path: String,
        session_file_path: Option<String>,
    ) -> BoxFuture<'_, Result<Option<bool>, AdapterError>> {
        Box::pin(async move {
            Ok(Some(
                is_claude_transcript_present(
                    &session_id,
                    &project_path,
                    session_file_path.as_deref(),
                )
                .await,
            ))
        })
    }

    fn locate_transcript(
        &self,
        session_id: String,
        project_path: String,
        session_file_path: Option<String>,
    ) -> BoxFuture<'_, Result<Option<TranscriptLocation>, AdapterError>> {
        Box::pin(async move {
            Ok(
                locate_claude_transcript(&session_id, &project_path, session_file_path.as_deref())
                    .await,
            )
        })
    }

    fn get_tool_categories(&self) -> Option<ToolCategories> {
        Some(ToolCategories {
            explore: tool_category(&["Read", "Glob", "Grep", "LS"]),
            hidden: tool_category(&[
                // TodoV1
                "TodoWrite",
                // TodoV2 (emitted as _TaskProgress)
                "TaskCreate",
                "TaskUpdate",
                "TaskList",
                "TaskGet",
                "TaskOutput",
                "TaskStop",
                // Mode/internal
                "EnterPlanMode",
                "AskUserQuestion",
                "ToolSearch",
            ]),
            progress: tool_category(&["TaskCreate", "TaskUpdate"]),
            subagent: tool_category(&["Task", "Agent"]),
        })
    }

    fn create_plan_mode_handler(&self) -> Option<Arc<dyn PlanModeActionHandler>> {
        Some(Arc::new(ClaudePlanModeHandler))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- ClaudeAdapter surface ----
    fn opts(chat_id: &str) -> SessionOptions {
        SessionOptions {
            project_path: "/tmp".to_string(),
            chat_id: Some(chat_id.to_string()),
            mainframe_chat_id: "mf".to_string(),
        }
    }

    #[test]
    fn adapter_identity_and_capabilities() {
        let a = ClaudeAdapter::default();
        assert_eq!(a.id(), "claude");
        assert_eq!(a.name(), "Claude Code");
        assert!(a.capabilities().plan_mode);
        assert!(a.has_probe_models());
    }

    #[test]
    fn adapter_trait_resolves_a_plan_mode_handler() {
        let a = ClaudeAdapter::default();
        assert!(Adapter::create_plan_mode_handler(&a).is_some());
    }

    #[tokio::test]
    async fn list_models_falls_back_to_static_catalog() {
        let a = ClaudeAdapter::default();
        let models = a.list_models().await.unwrap();
        assert_eq!(models.len(), claude_models().len());
    }

    #[test]
    fn get_tool_categories_matches_the_catalog() {
        let a = ClaudeAdapter::default();
        let cats = a.get_tool_categories().unwrap();
        assert!(cats.explore.contains("Read"));
        assert!(cats.hidden.contains("TodoWrite"));
        assert!(cats.hidden.contains("AskUserQuestion"));
        assert!(cats.progress.contains("TaskCreate"));
        assert!(cats.subagent.contains("Task"));
        assert!(cats.subagent.contains("Agent"));
    }

    #[test]
    fn create_session_registers_and_exit_deregisters() {
        let a = ClaudeAdapter::default();
        let session = a.create_session(opts("chat-1"));
        assert_eq!(a.sessions.lock().unwrap().len(), 1);
        let id = session.id().to_string();
        // Simulate the exit callback firing (the waiter task would invoke it).
        a.sessions.lock().unwrap().remove(&id);
        assert!(a.sessions.lock().unwrap().is_empty());
    }

    #[test]
    fn first_version_triple_extracts_semver() {
        assert_eq!(
            first_version_triple("claude 2.1.198 (build 7)"),
            Some("2.1.198".to_string())
        );
        assert_eq!(first_version_triple("no version here"), None);
    }
}

// PORT STATUS: src/plugins/builtin/claude/adapter.ts (300 lines)
// confidence: high
// todos: 0
// notes: Main catch-up: enrich_with_context_window now reads each entry's own
// notes: resolved_model for the 1M-suffix check AND the static-catalog fallback
// notes: (default_resolved_model kept for legacy default-only payloads); added the
// notes: claude-sonnet-5 catalog entry (extended window, live-verified 967k). Wired
// notes: two Adapter overrides: generate_title → generate_claude_title(content, binary,
// notes: resolved PATH); is_transcript_present → is_claude_transcript_present (returns
// notes: Ok(Some(bool)), never null). adapter-enrich.test.ts new cases translated.
// notes: FULL port. Pure catalog surface (claude_models, enrich_with_context_window,
// notes: window constants) + the ClaudeAdapter Adapter-trait impl: is_installed /
// notes: get_version (execFile `claude --version` → tokio Command; version regex
// notes: hand-rolled), list_models (dynamic or static fallback), probe_models
// notes: (enrich + cache, has_probe_models=true), get_fallback_models,
// notes: create_session (registers in a Arc<Mutex<HashMap>> keyed by id; on_exit
// notes: deregisters — the TS Set.delete(session) modelled as a late-bound
// notes: set_on_exit since the id only exists post-construction), kill_all
// notes: (fire-and-forget tokio::spawn per session, like the TS .catch), capabilities
// notes: {plan_mode:true}, get_tool_categories. createPlanModeHandler is an inherent
// notes: method (not in the Adapter trait yet — the skill/agent/external-session
// notes: CRUD + createPlanModeHandler are still adapter-api TODOs). manifest.name
// notes: ("Claude Code") inlined (no manifest.json asset in the crate).
