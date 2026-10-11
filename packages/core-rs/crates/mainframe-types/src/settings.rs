use serde::{Deserialize, Serialize};

mod provider_update;
pub use provider_update::{PROVIDER_CONFIG_FIELDS, ProviderConfigUpdate};

pub const EXECUTION_MODES: [ExecutionMode; 4] = [
    ExecutionMode::Default,
    ExecutionMode::AcceptEdits,
    ExecutionMode::Auto,
    ExecutionMode::Yolo,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExecutionMode {
    Default,
    AcceptEdits,
    Auto,
    Yolo,
}

impl ExecutionMode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::AcceptEdits => "acceptEdits",
            Self::Auto => "auto",
            Self::Yolo => "yolo",
        }
    }
}

/// `PermissionMode = ExecutionMode | 'plan'` — flattened into one enum since the
/// TS union has no discriminant beyond its own string value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PermissionMode {
    Default,
    AcceptEdits,
    Auto,
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
    /// Model the CLI uses for its own background calls on a CLIProxyAPI session,
    /// whose catalog has no Haiku to fall back on. Absent = pick from the catalog.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cliproxy_small_fast_model: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationChatConfig {
    pub task_complete: bool,
    pub session_error: bool,
    pub attention_request: bool,
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
                attention_request: true,
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
#[path = "settings_tests.rs"]
mod tests;
