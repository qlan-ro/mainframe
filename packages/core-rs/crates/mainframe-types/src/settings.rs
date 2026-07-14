//! Ported from `packages/types/src/settings.ts`.

use serde::{Deserialize, Serialize};

pub const EXECUTION_MODES: [ExecutionMode; 3] = [
    ExecutionMode::Default,
    ExecutionMode::AcceptEdits,
    ExecutionMode::Yolo,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExecutionMode {
    Default,
    AcceptEdits,
    Yolo,
}

/// `PermissionMode = ExecutionMode | 'plan'` — flattened into one enum since the
/// TS union has no discriminant beyond its own string value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PermissionMode {
    Default,
    AcceptEdits,
    Yolo,
    Plan,
}

/// `'true' | 'false'` string-literal flag used by several provider settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BoolString {
    True,
    False,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResolvedExecutableSource {
    Config,
    Detected,
    Fallback,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedExecutable {
    pub path: String,
    pub source: ResolvedExecutableSource,
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Personality {
    None,
    Friendly,
    Pragmatic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReasoningSummary {
    Auto,
    Concise,
    Detailed,
    None,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_mode: Option<ExecutionMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_plan_mode: Option<BoolString>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_executable: Option<ResolvedExecutable>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_effort: Option<crate::adapter::EffortLevel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_fast: Option<BoolString>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_ultracode: Option<BoolString>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_adaptive_thinking: Option<BoolString>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub personality: Option<Personality>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_summary: Option<ReasoningSummary>,
}

/// Patch shape for updating provider settings. The enum-valued fields additionally
/// accept `''` — the clear sentinel the server deletes on (→ the chat inherits the
/// model default). Those fields are typed `Option<String>` here so the empty-string
/// sentinel passes through the wire unchanged (serde enums cannot carry `''`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfigUpdate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_mode: Option<ExecutionMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_plan_mode: Option<BoolString>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_executable: Option<ResolvedExecutable>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_fast: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_ultracode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_adaptive_thinking: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub personality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_summary: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationChatConfig {
    pub task_complete: bool,
    pub session_error: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationPermissionConfig {
    pub tool_request: bool,
    pub user_question: bool,
    pub plan_approval: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotificationOtherConfig {
    pub plugin: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotificationConfig {
    pub chat: NotificationChatConfig,
    pub permission: NotificationPermissionConfig,
    pub other: NotificationOtherConfig,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UpdateChannel {
    Stable,
    Prerelease,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneralConfig {
    pub worktree_dir: String,
    pub notifications: NotificationConfig,
    pub update_channel: UpdateChannel,
    /// Adapter id used to seed new chats. `None` = auto-pick the first installed
    /// adapter. Not `skip_serializing_if`: the TS side always includes the key
    /// (explicit `null`), so the wire shape stays 1:1.
    pub default_adapter_id: Option<String>,
}

/// Mirrors the exported `NOTIFICATION_DEFAULTS` constant (all channels on).
impl Default for NotificationConfig {
    fn default() -> Self {
        Self {
            chat: NotificationChatConfig {
                task_complete: true,
                session_error: true,
            },
            permission: NotificationPermissionConfig {
                tool_request: true,
                user_question: true,
                plan_approval: true,
            },
            other: NotificationOtherConfig { plugin: true },
        }
    }
}

/// Mirrors the exported `GENERAL_DEFAULTS` constant.
impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            worktree_dir: ".worktrees".to_string(),
            notifications: NotificationConfig::default(),
            update_channel: UpdateChannel::Stable,
            default_adapter_id: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn execution_mode_serializes_camelcase() {
        assert_eq!(
            serde_json::to_string(&ExecutionMode::AcceptEdits).unwrap(),
            "\"acceptEdits\""
        );
        assert_eq!(
            serde_json::to_string(&ExecutionMode::Yolo).unwrap(),
            "\"yolo\""
        );
    }

    #[test]
    fn bool_string_serializes_lowercase() {
        assert_eq!(
            serde_json::to_string(&BoolString::True).unwrap(),
            "\"true\""
        );
    }

    #[test]
    fn provider_config_omits_all_absent_fields() {
        let cfg = ProviderConfig::default();
        assert_eq!(serde_json::to_string(&cfg).unwrap(), "{}");
    }

    #[test]
    fn provider_config_round_trips_populated() {
        let json = r#"{"defaultModel":"opus","defaultMode":"acceptEdits","defaultPlanMode":"false","personality":"friendly","reasoningSummary":"auto"}"#;
        let cfg: ProviderConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.default_mode, Some(ExecutionMode::AcceptEdits));
        assert_eq!(cfg.personality, Some(Personality::Friendly));
        assert_eq!(serde_json::to_string(&cfg).unwrap(), json);
    }

    #[test]
    fn provider_config_default_effort_is_effort_level() {
        let json = r#"{"defaultEffort":"high"}"#;
        let cfg: ProviderConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.default_effort, Some(crate::adapter::EffortLevel::High));
        assert_eq!(serde_json::to_string(&cfg).unwrap(), json);
    }

    #[test]
    fn provider_config_update_allows_empty_sentinel() {
        let json = r#"{"defaultEffort":"","personality":""}"#;
        let upd: ProviderConfigUpdate = serde_json::from_str(json).unwrap();
        assert_eq!(upd.default_effort.as_deref(), Some(""));
        assert_eq!(upd.personality.as_deref(), Some(""));
        assert_eq!(serde_json::to_string(&upd).unwrap(), json);
    }

    #[test]
    fn notification_defaults_match_ts_constant() {
        let json = serde_json::to_string(&NotificationConfig::default()).unwrap();
        assert_eq!(
            json,
            r#"{"chat":{"taskComplete":true,"sessionError":true},"permission":{"toolRequest":true,"userQuestion":true,"planApproval":true},"other":{"plugin":true}}"#
        );
    }

    #[test]
    fn general_defaults_match_ts_constant() {
        assert_eq!(GeneralConfig::default().worktree_dir, ".worktrees");
        assert_eq!(
            GeneralConfig::default().update_channel,
            UpdateChannel::Stable
        );
        assert_eq!(GeneralConfig::default().default_adapter_id, None);
    }

    /// `defaultAdapterId` always serializes (as `null` when absent) — no
    /// `skip_serializing_if`, matching the TS route's explicit `GENERAL_DEFAULTS`
    /// spread rather than an omitted key.
    #[test]
    fn general_config_default_adapter_id_serializes_as_explicit_null() {
        let value = serde_json::to_value(GeneralConfig::default()).unwrap();
        assert_eq!(value["defaultAdapterId"], serde_json::Value::Null);
    }

    #[test]
    fn update_channel_serializes_lowercase() {
        assert_eq!(
            serde_json::to_string(&UpdateChannel::Prerelease).unwrap(),
            "\"prerelease\""
        );
    }
}

// PORT STATUS: packages/types/src/settings.ts (68 lines)
// confidence: high
// todos: 0
// notes: literal-union settings → enums (ExecutionMode, PermissionMode, BoolString,
// Personality, ReasoningSummary, ResolvedExecutableSource). NOTIFICATION_DEFAULTS /
// GENERAL_DEFAULTS map to Default impls. NotificationConfig's inline nested object
// types are named structs (NotificationChatConfig etc.). ProviderConfig.default_effort
// is crate::adapter::EffortLevel (the real enum). ProviderConfigUpdate's `X | ''`
// sentinel fields (default_effort included) stay Option<String> so `''` round-trips
// (a serde enum can't carry it).
// catch-up (#236): GeneralConfig.default_adapter_id: Option<String> (TS
// `defaultAdapterId: string | null`) has no skip_serializing_if, so it always
// serializes (as `null` when unset) — matches the TS route always including the
// key via the GENERAL_DEFAULTS spread.
