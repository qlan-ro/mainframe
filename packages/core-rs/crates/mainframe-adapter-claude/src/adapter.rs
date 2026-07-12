//! Ported from `packages/core/src/plugins/builtin/claude/adapter.ts`.
//!
//! This file ports the pure catalog surface — the static `CLAUDE_MODELS` fallback
//! and `enrich_with_context_window`. The `ClaudeAdapter` struct itself (the
//! `Adapter` trait impl) is deferred: it constructs `ClaudeSession`, calls into
//! `skills`/`external_sessions`, holds a `BackgroundTaskTracker`, and returns
//! `ToolCategories` — none of which have landed yet (see the trailer).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use mainframe_adapter_api::{
    Adapter, AdapterError, AdapterSession, BoxFuture, PlanModeActionHandler,
};
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_runtime::ResolvedPath;
use mainframe_types::adapter::{AdapterCapabilities, AdapterModel, EffortLevel, SessionOptions};
use mainframe_types::display::ToolCategories;

use crate::plan_mode_handler::ClaudePlanModeHandler;
use crate::session::ClaudeSession;
use crate::title_generator::generate_claude_title;
use crate::transcript::is_claude_transcript_present;

/// The manifest `name` (the TS adapter imports `manifest.json`; the Rust port has
/// no manifest asset, so the string is inlined).
const CLAUDE_ADAPTER_NAME: &str = "Claude Code";

const DEFAULT_CONTEXT_WINDOW: i64 = 200_000;
const EXTENDED_CONTEXT_WINDOW: i64 = 1_000_000;

fn m(id: &str, label: &str, context_window: i64) -> AdapterModel {
    AdapterModel {
        id: id.to_string(),
        label: label.to_string(),
        description: None,
        resolved_model: None,
        context_window: Some(context_window),
        is_default: None,
        supported_efforts: None,
        default_effort: None,
        supports_fast: None,
        supports_ultracode: None,
        supports_adaptive_thinking: None,
        supports_personality: None,
    }
}

fn efforts(levels: &[EffortLevel]) -> Option<Vec<EffortLevel>> {
    Some(levels.to_vec())
}

/// The CLI accepts "default" as an alias that resolves to the user's tier default
/// at spawn time; the probe replaces this with the live catalog. Static fallback
/// (`getFallbackModels`).
pub fn claude_models() -> Vec<AdapterModel> {
    use EffortLevel::{High, Low, Max, Medium, Xhigh};
    let mut models = Vec::new();

    let mut default = m("default", "Default - Opus 4.8", EXTENDED_CONTEXT_WINDOW);
    default.description = Some("Opus 4.8 with 1M context".to_string());
    default.supported_efforts = efforts(&[Low, Medium, High, Xhigh, Max]);
    default.supports_fast = Some(true);
    default.supports_ultracode = Some(true);
    default.supports_adaptive_thinking = Some(true);
    default.is_default = Some(true);
    models.push(default);

    let mut opus46 = m("claude-opus-4-6", "Opus 4.6", DEFAULT_CONTEXT_WINDOW);
    opus46.supported_efforts = efforts(&[Low, Medium, High, Xhigh, Max]);
    opus46.supports_fast = Some(true);
    opus46.supports_ultracode = Some(true);
    opus46.supports_adaptive_thinking = Some(true);
    models.push(opus46);

    let mut opus46_1m = m("opus[1m]", "Opus 4.6 (1M context)", EXTENDED_CONTEXT_WINDOW);
    opus46_1m.supported_efforts = efforts(&[Low, Medium, High, Xhigh, Max]);
    opus46_1m.supports_fast = Some(true);
    opus46_1m.supports_ultracode = Some(true);
    opus46_1m.supports_adaptive_thinking = Some(true);
    models.push(opus46_1m);

    let mut sonnet46 = m("claude-sonnet-4-6", "Sonnet 4.6", DEFAULT_CONTEXT_WINDOW);
    sonnet46.supported_efforts = efforts(&[Low, Medium, High, Max]);
    sonnet46.supports_fast = Some(true);
    models.push(sonnet46);

    let mut sonnet46_1m = m(
        "sonnet[1m]",
        "Sonnet 4.6 (1M context)",
        EXTENDED_CONTEXT_WINDOW,
    );
    sonnet46_1m.supported_efforts = efforts(&[Low, Medium, High, Max]);
    sonnet46_1m.supports_fast = Some(true);
    models.push(sonnet46_1m);

    let mut opus45 = m(
        "claude-opus-4-5-20251101",
        "Opus 4.5",
        DEFAULT_CONTEXT_WINDOW,
    );
    opus45.supported_efforts = efforts(&[Low, Medium, High, Xhigh, Max]);
    opus45.supports_ultracode = Some(true);
    models.push(opus45);

    let mut sonnet45 = m(
        "claude-sonnet-4-5-20250929",
        "Sonnet 4.5",
        DEFAULT_CONTEXT_WINDOW,
    );
    sonnet45.supported_efforts = efforts(&[Low, Medium, High, Max]);
    models.push(sonnet45);

    let mut opus41 = m(
        "claude-opus-4-1-20250805",
        "Opus 4.1",
        DEFAULT_CONTEXT_WINDOW,
    );
    opus41.supported_efforts = efforts(&[Low, Medium, High, Xhigh, Max]);
    opus41.supports_ultracode = Some(true);
    models.push(opus41);

    let mut sonnet4 = m(
        "claude-sonnet-4-20250514",
        "Sonnet 4",
        DEFAULT_CONTEXT_WINDOW,
    );
    sonnet4.supported_efforts = efforts(&[Low, Medium, High, Max]);
    models.push(sonnet4);

    let mut opus40 = m("claude-opus-4-20250514", "Opus 4.0", DEFAULT_CONTEXT_WINDOW);
    opus40.supported_efforts = efforts(&[Low, Medium, High, Xhigh, Max]);
    opus40.supports_ultracode = Some(true);
    models.push(opus40);

    let mut sonnet37 = m(
        "claude-3-7-sonnet-20250219",
        "Sonnet 3.7",
        DEFAULT_CONTEXT_WINDOW,
    );
    sonnet37.supported_efforts = efforts(&[Low, Medium, High, Max]);
    models.push(sonnet37);

    // Window live-verified 2026-07-07: the CLI's get_context_usage reports
    // maxTokens 967,000 for claude-sonnet-5 (1M minus the CLI's reserve).
    models.push(m("claude-sonnet-5", "Sonnet 5", EXTENDED_CONTEXT_WINDOW));
    models.push(m(
        "claude-haiku-4-5-20251001",
        "Haiku 4.5",
        DEFAULT_CONTEXT_WINDOW,
    ));
    models.push(m(
        "claude-3-5-sonnet-20241022",
        "Sonnet 3.5",
        DEFAULT_CONTEXT_WINDOW,
    ));
    models.push(m(
        "claude-3-5-haiku-20241022",
        "Haiku 3.5",
        DEFAULT_CONTEXT_WINDOW,
    ));

    models
}

fn has_extended_window_suffix(id: &str) -> bool {
    id.to_lowercase().ends_with("[1m]")
}

/// `/\b1m\b|1m context/i` on a description.
fn description_hints_extended(description: &str) -> bool {
    let lower = description.to_lowercase();
    if lower.contains("1m context") {
        return true;
    }
    // `\b1m\b` — "1m" bounded by non-word chars.
    let chars: Vec<char> = lower.chars().collect();
    let n = chars.len();
    let is_word = |c: char| c.is_ascii_alphanumeric() || c == '_';
    let mut i = 0;
    while i + 2 <= n {
        if chars[i] == '1' && chars[i + 1] == 'm' {
            let before_ok = i == 0 || !is_word(chars[i - 1]);
            let after_ok = i + 2 >= n || !is_word(chars[i + 2]);
            if before_ok && after_ok {
                return true;
            }
        }
        i += 1;
    }
    false
}

/// Reconcile probed entries with the static catalog so known IDs retain their
/// authoritative window, unknown IDs ending in "[1m]" (on the entry id OR its own
/// `resolvedModel` — the CLI puts the suffix on either side, e.g.
/// `claude-fable-5[1m]` resolves to a bare `claude-fable-5`) get the extended
/// window, and everything else falls back to a description sniff before the 200k
/// default. `default_resolved_model` is kept for callers probing legacy payloads
/// where only the "default" entry carried a resolution.
pub fn enrich_with_context_window(
    probed: Vec<AdapterModel>,
    default_resolved_model: Option<&str>,
) -> Vec<AdapterModel> {
    let static_windows: std::collections::HashMap<String, i64> = claude_models()
        .into_iter()
        .filter_map(|model| model.context_window.map(|w| (model.id, w)))
        .collect();

    probed
        .into_iter()
        .map(|mut model| {
            // TS `if (model.contextWindow) return model;` — truthy (present & nonzero).
            if model.context_window.filter(|&w| w != 0).is_some() {
                return model;
            }
            // model.resolvedModel ?? (id === 'default' ? defaultResolvedModel : undefined)
            let resolved: Option<String> = model.resolved_model.clone().or_else(|| {
                if model.id == "default" {
                    default_resolved_model.map(str::to_string)
                } else {
                    None
                }
            });
            let resolved_ref = resolved.as_deref();
            if has_extended_window_suffix(&model.id)
                || resolved_ref
                    .map(has_extended_window_suffix)
                    .unwrap_or(false)
            {
                model.context_window = Some(EXTENDED_CONTEXT_WINDOW);
                return model;
            }
            // staticById.get(id)?.contextWindow ?? (resolved && staticById.get(resolved)?.contextWindow)
            let from_static = static_windows
                .get(&model.id)
                .copied()
                .or_else(|| resolved_ref.and_then(|r| static_windows.get(r).copied()));
            if let Some(w) = from_static {
                model.context_window = Some(w);
                return model;
            }
            let window = if model
                .description
                .as_deref()
                .map(description_hints_extended)
                .unwrap_or(false)
            {
                EXTENDED_CONTEXT_WINDOW
            } else {
                DEFAULT_CONTEXT_WINDOW
            };
            model.context_window = Some(window);
            model
        })
        .collect()
}

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

pub struct ClaudeAdapter {
    background_tasks: Arc<BackgroundTaskTracker>,
    sessions: Arc<Mutex<HashMap<String, Arc<ClaudeSession>>>>,
    dynamic_models: Arc<Mutex<Option<Vec<AdapterModel>>>>,
    /// Boot-resolved login-shell `PATH`, applied to every spawned `claude` CLI so
    /// packaged builds find it outside the bare launchd `PATH` (mirrors the TS
    /// `enrichPath` env mutation).
    resolved_path: ResolvedPath,
}

impl ClaudeAdapter {
    pub fn new(background_tasks: Arc<BackgroundTaskTracker>, resolved_path: ResolvedPath) -> Self {
        Self {
            background_tasks,
            sessions: Arc::new(Mutex::new(HashMap::new())),
            dynamic_models: Arc::new(Mutex::new(None)),
            resolved_path,
        }
    }

    /// `createPlanModeHandler()` — the per-adapter plan-mode strategy.
    pub fn create_plan_mode_handler(&self) -> Box<dyn PlanModeActionHandler> {
        Box::new(ClaudePlanModeHandler)
    }
}

impl Default for ClaudeAdapter {
    fn default() -> Self {
        Self::new(
            Arc::new(BackgroundTaskTracker::new()),
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
        AdapterCapabilities { plan_mode: true }
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
        Box::pin(async move {
            let models = dynamic
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone()
                .unwrap_or_else(claude_models);
            Ok(models)
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
        let path = self.resolved_path.clone();
        Box::pin(async move {
            let exe = executable_path.unwrap_or_else(|| "claude".to_string());
            if let Some(result) = crate::probe_models::probe_models(&exe, path.as_str()).await {
                let enriched =
                    enrich_with_context_window(result.models, result.resolved_model.as_deref());
                *dynamic.lock().unwrap_or_else(|e| e.into_inner()) = Some(enriched);
            }
            Ok(dynamic.lock().unwrap_or_else(|e| e.into_inner()).clone())
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
}

#[cfg(test)]
mod tests {
    use super::*;

    fn probed(id: &str) -> AdapterModel {
        AdapterModel {
            id: id.to_string(),
            label: id.to_string(),
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
        }
    }

    fn window_of(models: &[AdapterModel], id: &str) -> Option<i64> {
        models
            .iter()
            .find(|m| m.id == id)
            .and_then(|m| m.context_window)
    }

    // These port probe-context-window.test.ts's enrichment assertions. The TS
    // harness drives them through a mocked `ClaudeAdapter.probeModels()`, which is
    // exactly `enrich_with_context_window(result.models, result.resolvedModel)`;
    // called directly here since the adapter struct is deferred (above).

    #[test]
    fn preserves_context_window_from_static_catalog_for_known_ids() {
        let mut default = probed("default");
        default.is_default = Some(true);
        default.description = Some("Opus 4.7 with 1M context · Most capable".to_string());
        let out = enrich_with_context_window(
            vec![default, probed("claude-sonnet-4-6"), probed("sonnet[1m]")],
            None,
        );
        assert_eq!(window_of(&out, "default"), Some(1_000_000));
        assert_eq!(window_of(&out, "claude-sonnet-4-6"), Some(200_000));
        assert_eq!(window_of(&out, "sonnet[1m]"), Some(1_000_000));
    }

    #[test]
    fn falls_back_to_description_sniff_for_unknown_ids() {
        let mut big = probed("claude-future-1m");
        big.description = Some("Future model with 1M context".to_string());
        let mut small = probed("claude-future-small");
        small.description = Some("Faster everyday model".to_string());
        let out = enrich_with_context_window(vec![big, small], None);
        assert_eq!(window_of(&out, "claude-future-1m"), Some(1_000_000));
        assert_eq!(window_of(&out, "claude-future-small"), Some(200_000));
    }

    #[test]
    fn respects_explicit_context_window_on_probed_entry() {
        let mut custom = probed("claude-custom");
        custom.context_window = Some(500_000);
        let out = enrich_with_context_window(vec![custom], None);
        assert_eq!(out[0].context_window, Some(500_000));
    }

    #[test]
    fn stamps_default_window_from_resolved_model_without_description() {
        let mut default = probed("default");
        default.is_default = Some(true);
        let out = enrich_with_context_window(vec![default], Some("claude-fable-5[1m]"));
        assert_eq!(out[0].context_window, Some(1_000_000));
    }

    // Translated assertion-for-assertion from the new adapter-enrich.test.ts cases
    // (each probed entry carries its own resolvedModel).
    fn probed_full(id: &str, description: &str, resolved: &str) -> AdapterModel {
        let mut m = probed(id);
        m.description = Some(description.to_string());
        m.resolved_model = Some(resolved.to_string());
        m
    }

    #[test]
    fn infers_1m_from_a_non_default_entry_whose_own_resolved_model_carries_1m() {
        let probed = vec![
            probed_full(
                "opus[1m]",
                "Opus 4.8 with 1M context",
                "claude-opus-4-8[1m]",
            ),
            probed_full("my-alias", "Some model", "claude-something-9[1m]"),
        ];
        let enriched = enrich_with_context_window(probed, None);
        assert_eq!(enriched[0].context_window, Some(1_000_000));
        assert_eq!(enriched[1].context_window, Some(1_000_000));
    }

    #[test]
    fn keeps_the_1m_id_suffix_authoritative_even_when_resolved_model_drops_it() {
        let probed = vec![probed_full(
            "claude-fable-5[1m]",
            "Fable 5",
            "claude-fable-5",
        )];
        assert_eq!(
            enrich_with_context_window(probed, None)[0].context_window,
            Some(1_000_000)
        );
    }

    #[test]
    fn resolves_the_static_catalog_window_via_the_entry_resolved_model_for_alias_ids() {
        let probed = vec![probed_full("haiku", "Fastest", "claude-haiku-4-5-20251001")];
        assert_eq!(
            enrich_with_context_window(probed, None)[0].context_window,
            Some(200_000)
        );
    }

    #[test]
    fn gives_claude_sonnet_5_the_extended_window_from_the_static_catalog() {
        let probed = vec![probed_full(
            "sonnet",
            "Efficient for routine tasks",
            "claude-sonnet-5",
        )];
        assert_eq!(
            enrich_with_context_window(probed, None)[0].context_window,
            Some(1_000_000)
        );
    }

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
