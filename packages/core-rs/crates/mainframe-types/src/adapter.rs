//! Ported from `packages/types/src/adapter.ts`.
//!
//! Data types only. The `Adapter` / `AdapterSession` / `SessionSink` *trait*
//! interfaces from the TS file live in `mainframe-adapter-api` (per the crate
//! map §2.6); this module ports the serde DTOs they exchange plus the pure
//! effort-clamp logic.

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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOptions {
    pub project_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chat_id: Option<String>,
    pub mainframe_chat_id: String,
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
}

/// Full union across both CLIs. Codex ReasoningEffort = none..xhigh; Claude adds
/// `max`. The per-model `supportedEfforts` array is the runtime gate.
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

/// Single source of truth for the boolean tuning features. Mirrors the TS
/// `TUNABLE_FEATURES` const array (resolver clamp, Claude flag-settings mapping,
/// and renderer gating all iterate this).
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
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn roundtrip<T>(v: Value)
    where
        T: serde::de::DeserializeOwned + serde::Serialize,
    {
        let parsed: T = serde_json::from_value(v.clone()).unwrap();
        let back = serde_json::to_value(&parsed).unwrap();
        assert_eq!(v, back);
    }

    #[test]
    fn control_request_full_tagged_suggestion() {
        let v = json!({
            "requestId": "req_001",
            "toolName": "Bash",
            "toolUseId": "toolu_01A",
            "input": { "command": "rm -rf /tmp/scratch" },
            "suggestions": [
                {
                    "type": "addRules",
                    "rules": [ { "toolName": "Bash", "ruleContent": "rm -rf /tmp/*" } ],
                    "behavior": "allow",
                    "destination": "session"
                }
            ],
            "decisionReason": "Destructive command outside project root"
        });
        roundtrip::<ControlRequest>(v);
    }

    #[test]
    fn control_request_minimal_omits_reason() {
        let v = json!({
            "requestId": "req_001",
            "toolName": "Bash",
            "toolUseId": "toolu_01A",
            "input": { "command": "ls" },
            "suggestions": []
        });
        roundtrip::<ControlRequest>(v.clone());
        let s =
            serde_json::to_string(&serde_json::from_value::<ControlRequest>(v).unwrap()).unwrap();
        assert!(!s.contains("decisionReason"));
    }

    #[test]
    fn control_update_set_mode_variant() {
        let v = json!({ "type": "setMode", "mode": "plan", "destination": "session" });
        roundtrip::<ControlUpdate>(v);
    }

    #[test]
    fn adapter_model_minimal_and_full() {
        roundtrip::<AdapterModel>(json!({ "id": "claude-sonnet-5", "label": "Sonnet 5" }));
        roundtrip::<AdapterModel>(json!({
            "id": "claude-opus-4-8",
            "label": "Opus 4.8",
            "description": "Most capable Claude model",
            "resolvedModel": "claude-opus-4-8-20260101",
            "contextWindow": 200000,
            "isDefault": true,
            "supportedEfforts": ["low", "medium", "high", "max"],
            "defaultEffort": "medium",
            "supportsFast": true,
            "supportsUltracode": true,
            "supportsAdaptiveThinking": true,
            "supportsPersonality": false
        }));
    }

    #[test]
    fn effort_level_xhigh_serializes_without_underscore() {
        assert_eq!(
            serde_json::to_string(&EffortLevel::Xhigh).unwrap(),
            "\"xhigh\""
        );
        let e: EffortLevel = serde_json::from_str("\"xhigh\"").unwrap();
        assert_eq!(e, EffortLevel::Xhigh);
    }

    #[test]
    fn external_session_page_null_next_offset() {
        let v = json!({ "sessions": [], "total": 0, "nextOffset": null });
        roundtrip::<ExternalSessionPage>(v);
    }

    #[test]
    fn session_result_context_tokens_optional() {
        // absent contextTokens → None → omitted on the way back out
        // (SessionResult keys are snake_case except the camelCase contextTokens)
        roundtrip::<SessionResult>(json!({ "subtype": "success", "is_error": false }));
        // explicit number survives
        roundtrip::<SessionResult>(json!({ "contextTokens": 12345, "is_error": false }));
        // explicit null collapses to None (absent) on re-serialize
        let r: SessionResult = serde_json::from_value(json!({ "contextTokens": null })).unwrap();
        assert_eq!(r.context_tokens, None);
        assert!(!serde_json::to_string(&r).unwrap().contains("contextTokens"));
    }

    #[test]
    fn detected_pr_source_enum() {
        roundtrip::<DetectedPr>(json!({
            "url": "https://github.com/qlan-ro/mainframe/pull/412",
            "owner": "qlan-ro",
            "repo": "mainframe",
            "number": 412,
            "source": "created"
        }));
    }

    #[test]
    fn clamp_matches_ts_logic() {
        use EffortLevel as E;
        // requested supported → itself
        assert_eq!(
            clamp_effort_to_supported(E::High, &[E::Low, E::Medium, E::High], None),
            Some(E::High)
        );
        // not supported, default supported → default
        assert_eq!(
            clamp_effort_to_supported(E::Max, &[E::Low, E::Medium, E::High], Some(E::Medium)),
            Some(E::Medium)
        );
        // not supported, no usable default → highest ≤ requested
        assert_eq!(
            clamp_effort_to_supported(E::High, &[E::Low, E::Medium], None),
            Some(E::Medium)
        );
        // requested below everything → lowest supported
        assert_eq!(
            clamp_effort_to_supported(E::None, &[E::Medium, E::High], None),
            Some(E::Medium)
        );
        // empty → None
        assert_eq!(clamp_effort_to_supported(E::High, &[], None), None);
    }
}

// PORT STATUS: packages/types/src/adapter.ts (395 lines)
// confidence: high
// todos: 0
// notes: Main catch-up (#424/#425/#441): SessionResult.contextTokens (Option<i64>,
// serde default+skip; absent/null both → None, three-way branch lives in the
// event-handler producer) and AdapterModel.resolvedModel (Option<String>, skip).
// The new Adapter TRAIT methods generateTitle/isTranscriptPresent land in
// mainframe-adapter-api (behavioral half). Data DTOs + effort-clamp logic only;
// the Adapter/AdapterSession/
// SessionSink TRAIT interfaces are intentionally NOT here — they port to
// mainframe-adapter-api (crate map §2.6). MessageMetadata.usage / SessionResult
// fields stay snake_case (they mirror the CLI usage payload; fixture
// message.added shows input_tokens/output_tokens). ControlUpdate is internally
// tagged (rename_all gives addRules/replaceRules/... tag values). References
// crate::settings::{ExecutionMode,PermissionMode} and crate::chat::ResolvedTuning
// (owned by the sibling types-port task). TUNABLE_FEATURES / clampEffortToSupported
// ported as const + fn with a logic-parity test.
