//! Data types only. The `Adapter` / `AdapterSession` / `SessionSink` *trait*
//! interfaces live in `mainframe-adapter-api`; this module holds the serde DTOs
//! they exchange plus the pure effort-clamp logic.

use serde::{Deserialize, Serialize};

use crate::chat::ResolvedTuning;
use crate::settings::{ExecutionMode, PermissionMode};

/// Token usage sub-object. Fields are snake_case on the wire (they mirror the
/// CLI's own usage payload) — no camelCase rename.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MessageUsage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_creation_input_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_read_input_tokens: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MessageMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<MessageUsage>,
    /// The adapter's own stable id for this message (Claude: transcript
    /// `uuid`; Codex: thread-item id) — never serialized to the wire, only
    /// consumed by `SessionSinkImpl::on_message` as the `ChatMessage.id`.
    /// `None` falls back to a minted nanoid.
    #[serde(skip)]
    pub vendor_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_cost_usd: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<MessageUsage>,
    /// Tokens occupying the context window at the turn's last model call
    /// (input + cache of the final parent assistant message). `null`/absent both
    /// deserialize to `None`; the producing side (event-handler) distinguishes
    /// absent (fall back to `usage`) from explicit null (keep stored size).
    ///
    /// `contextTokens` is camelCase on the wire even though this struct's other
    /// keys are snake_case (they mirror the CLI usage payload) — hence the rename.
    #[serde(
        rename = "contextTokens",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub context_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtype: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
}

/// What a fork's first spawn resumes from: the parent's provider session id
/// (never itself a resume target — see `mainframe-adapter-claude::fork`) plus
/// whatever pins the fork point (Claude: a snapshot transcript path).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForkSource {
    pub source_session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resume_path: Option<String>,
    /// The parent's last turn id at the moment of pinning — Codex's
    /// `thread/fork` forks "through, inclusive" this turn, so the fork point
    /// stays fixed at the click even if the parent gains turns afterward.
    /// `None` when the parent had no turns yet, or the adapter has no turn-level
    /// fork granularity (Claude pins a transcript snapshot instead).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_turn_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOptions {
    pub project_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chat_id: Option<String>,
    pub mainframe_chat_id: String,
    /// The chat's stored transcript path (`Chat::session_file_path`), when known.
    /// Claude's history load resolves this first, falling back to the path
    /// derived from `project_path` — see `locate_claude_transcript`. Omitted from
    /// the wire shape when absent so it never changes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_file_path: Option<String>,
    /// Set only for a fork's spawn (own session id absent, or present but its
    /// transcript missing). `mainframe-chat`'s `build_history_session` /
    /// `do_load_chat` / `do_start_chat` populate it from `chats.pending_fork`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fork_source: Option<ForkSource>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSpawnOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<ExecutionMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_mode: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tuning: Option<ResolvedTuning>,
    /// Overrides the model the CLI uses for its own background calls when the chat
    /// runs against CLIProxyAPI, whose catalog has no Haiku to fall back on.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub small_fast_model: Option<String>,
    /// Legacy hint retained for compatibility; configured overrides are passed through `model`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
    /// Set only for a temporary chat whose adapter reports
    /// `AdapterCapabilities.no_persistence`. The chat layer never sets this for a
    /// non-temporary chat or for an adapter without the capability. A no-persistence
    /// spawn never carries a resume target.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub no_persistence: Option<bool>,
    /// The orchestration MCP endpoint + this spawn's bearer token. Never
    /// serialized: the token lives only here and in the child's environment.
    #[serde(skip)]
    pub orchestration_mcp: Option<crate::orchestration::OrchestrationMcpLaunch>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdapterProcessStatus {
    Starting,
    Ready,
    Running,
    Stopped,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterProcess {
    pub id: String,
    pub adapter_id: String,
    pub chat_id: String,
    pub pid: i64,
    pub status: AdapterProcessStatus,
    pub project_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ControlBehavior {
    Allow,
    Deny,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ControlDestination {
    UserSettings,
    ProjectSettings,
    LocalSettings,
    Session,
    CliArg,
}

/// Behavior selector on rule-mutating `ControlUpdate` variants.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuleBehavior {
    Allow,
    Deny,
    Ask,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlRule {
    pub tool_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule_content: Option<String>,
}

/// A control rule update to save for future tool uses.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ControlUpdate {
    AddRules {
        rules: Vec<ControlRule>,
        behavior: RuleBehavior,
        destination: ControlDestination,
    },
    ReplaceRules {
        rules: Vec<ControlRule>,
        behavior: RuleBehavior,
        destination: ControlDestination,
    },
    RemoveRules {
        rules: Vec<ControlRule>,
        behavior: RuleBehavior,
        destination: ControlDestination,
    },
    SetMode {
        mode: PermissionMode,
        destination: ControlDestination,
    },
    AddDirectories {
        directories: Vec<String>,
        destination: ControlDestination,
    },
    RemoveDirectories {
        directories: Vec<String>,
        destination: ControlDestination,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlRequest {
    pub request_id: String,
    pub tool_name: String,
    pub tool_use_id: String,
    pub input: std::collections::HashMap<String, serde_json::Value>,
    pub suggestions: Vec<ControlUpdate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision_reason: Option<String>,
    /// The adapter's own ordered option list. `None` keeps
    /// today's Claude derivation (`gates::offered_options`); Codex sets
    /// `Some` with its real accept/acceptForSession/decline or question
    /// choices, so `gates::parse_answer` no longer has to guess a fixed
    /// three-string vocabulary.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<crate::acp::permission::PermissionOption>>,
}

/// Whether a granted permission covers just this call or the rest of the
/// session. Distinct from `ControlUpdate::SetMode`, which
/// Claude still uses for its own persisted rule scopes — this rides the
/// answer itself for adapters (Codex) that have no equivalent rule store.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionScope {
    Once,
    Session,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlResponse {
    pub request_id: String,
    pub tool_use_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    pub behavior: ControlBehavior,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_input: Option<std::collections::HashMap<String, serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_permissions: Option<Vec<ControlUpdate>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_mode: Option<ExecutionMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clear_context: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<PermissionScope>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextUsage {
    pub percentage: f64,
    pub total_tokens: i64,
    pub max_tokens: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum QuotaWindowKind {
    Session,
    Weekly,
    WeeklyModel,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaWindow {
    pub kind: QuotaWindowKind,
    pub used_percent: f64,
    pub resets_at: Option<i64>,
    /// When this window last carried real data. A null `resets_at` synthesizes its
    /// ceiling from this instant (not the blob's), so a kept window's ceiling can't
    /// float forward on a data-free push. Omitted for windows built before #268.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observed_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderQuotaStatus {
    Ok,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderQuota {
    pub status: ProviderQuotaStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<QuotaWindow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weekly: Option<QuotaWindow>,
    pub model_windows: Vec<QuotaWindow>,
    pub observed_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_identity: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DetectedPrSource {
    Created,
    Mentioned,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedPr {
    pub url: String,
    pub owner: String,
    pub repo: String,
    pub number: i64,
    pub source: DetectedPrSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CatalogSource {
    Probed,
    Fallback,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterCapabilities {
    pub plan_mode: bool,
    /// Whether this adapter supports the CLI's native `auto` permission mode.
    pub auto_mode: bool,
    /// The adapter's CLI has a native mechanism to run a session without writing
    /// a vendor transcript (Claude `--no-session-persistence`, Codex
    /// `thread/start.ephemeral`), verified interactively.
    /// `#[serde(default)]` so a payload recorded before this field existed still
    /// deserializes, defaulting to false (no mechanism).
    #[serde(default)]
    pub no_persistence: bool,
    /// Whether this adapter can branch a chat's conversation into a new chat.
    /// Absent on the wire (older daemon) deserializes to `false`.
    #[serde(default)]
    pub fork: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub models: Vec<AdapterModel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models_revision: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog_source: Option<CatalogSource>,
    pub capabilities: AdapterCapabilities,
    /// Why `capabilities.fork` is currently `false`, e.g. a CLI
    /// below the version that introduced the fork RPC. `None` when fork is
    /// available or the adapter has no version-gated fork story. Absent on the
    /// wire (older daemon, or an adapter/state with no reason) deserializes to
    /// `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fork_unavailable_reason: Option<String>,
}

/// Full union across both CLIs. Codex ReasoningEffort = none..xhigh, plus
/// `ultra` on some models; Claude adds `max`. The per-model `supportedEfforts`
/// array is the runtime gate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EffortLevel {
    None,
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
    Max,
    Ultra,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterModel {
    pub id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Concrete model id an alias entry currently resolves to (CLI probe, per-entry).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_default: Option<bool>,
    /// Older-but-still-active model Mainframe offers beyond the CLI's own picker.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_older: Option<bool>,
    /// Labelled picker section this model belongs to; absent = the adapter's main list.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supported_efforts: Option<Vec<EffortLevel>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_effort: Option<EffortLevel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supports_fast: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supports_ultracode: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supports_adaptive_thinking: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supports_personality: Option<bool>,
}

/// The endpoint a model id is namespaced to (`cliproxy/gpt-5.6-sol` → `cliproxy`),
/// or `None` for a native id. Which endpoints exist is the adapter's business; all
/// the chat layer needs is that crossing endpoints costs a respawn, since the
/// endpoint is fixed in the child process's environment.
pub fn model_endpoint(model: &str) -> Option<&str> {
    model
        .split_once('/')
        .filter(|(endpoint, bare)| !endpoint.is_empty() && !bare.is_empty())
        .map(|(endpoint, _)| endpoint)
}

/// Single source of truth for the boolean tuning features (resolver clamp, Claude
/// flag-settings mapping, and renderer gating all iterate this). Wire contract:
/// the keys must match `TUNABLE_FEATURES` in `packages/types/src/adapter.ts`,
/// which the UI's `ProviderTuningDefaults` pane iterates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TunableFeature {
    pub key: &'static str,
    pub capability: &'static str,
    pub claude_setting: &'static str,
    pub provider_default: &'static str,
}

pub const TUNABLE_FEATURES: [TunableFeature; 3] = [
    TunableFeature {
        key: "fast",
        capability: "supportsFast",
        claude_setting: "fastMode",
        provider_default: "defaultFast",
    },
    TunableFeature {
        key: "ultracode",
        capability: "supportsUltracode",
        claude_setting: "ultracode",
        provider_default: "defaultUltracode",
    },
    TunableFeature {
        key: "adaptiveThinking",
        capability: "supportsAdaptiveThinking",
        claude_setting: "alwaysThinkingEnabled",
        provider_default: "defaultAdaptiveThinking",
    },
];

fn effort_rank(effort: EffortLevel) -> u8 {
    match effort {
        EffortLevel::None => 0,
        EffortLevel::Minimal => 1,
        EffortLevel::Low => 2,
        EffortLevel::Medium => 3,
        EffortLevel::High => 4,
        EffortLevel::Xhigh => 5,
        EffortLevel::Max => 6,
        EffortLevel::Ultra => 7,
    }
}

/// Clamp a requested effort to what a model supports — the single source of
/// truth used by both the core resolver and the renderer.
///
/// - requested ∈ supported → requested
/// - else default ∈ supported → default
/// - else highest supported ≤ requested (then lowest supported)
/// - supported empty → None
pub fn clamp_effort_to_supported(
    requested: EffortLevel,
    supported: &[EffortLevel],
    default_effort: Option<EffortLevel>,
) -> Option<EffortLevel> {
    if supported.is_empty() {
        return None;
    }
    if supported.contains(&requested) {
        return Some(requested);
    }
    if let Some(def) = default_effort
        && supported.contains(&def)
    {
        return Some(def);
    }
    let mut below: Vec<EffortLevel> = supported
        .iter()
        .copied()
        .filter(|e| effort_rank(*e) <= effort_rank(requested))
        .collect();
    below.sort_by_key(|e| std::cmp::Reverse(effort_rank(*e)));
    if let Some(first) = below.first() {
        return Some(*first);
    }
    let mut ascending: Vec<EffortLevel> = supported.to_vec();
    ascending.sort_by_key(|e| effort_rank(*e));
    ascending.first().copied()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalSession {
    pub session_id: String,
    pub adapter_id: String,
    pub project_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_count: Option<i64>,
    pub created_at: String,
    pub modified_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

/// A page of importable external sessions. `total` is the candidate (stat-only)
/// count; `nextOffset` is the next offset to request, or `null` when exhausted.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalSessionPage {
    pub sessions: Vec<ExternalSession>,
    pub total: i64,
    pub next_offset: Option<i64>,
}

#[cfg(test)]
#[path = "adapter_tests.rs"]
mod tests;
