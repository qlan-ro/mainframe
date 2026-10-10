mod unpersisted;
use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::adapter::{ControlRequest, EffortLevel};
use crate::content::{LeafContent, ToolResultImage};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TodoStatus {
    Pending,
    InProgress,
    Completed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    pub content: String,
    pub status: TodoStatus,
    pub active_form: String,
}

/// Id of the hidden scratch project row that owns every non-project chat's
/// `project_id`. Excluded from every `ProjectsRepository` read; removal is
/// refused at every layer that would otherwise cascade-delete non-project
/// chats.
pub const NO_PROJECT_ID: &str = "mainframe-no-project";

/// Fields for a new chat, threaded from the create route through the lifecycle
/// manager down to `ChatsRepository::create`. Owned strings (rather than
/// borrows) because the request crosses several trait-object boundaries
/// (`dyn LifecycleManagerDeps`, `dyn ChatManagerDeps`, ...).
#[derive(Debug, Clone, Default)]
pub struct NewChat {
    pub project_id: String,
    pub adapter_id: String,
    pub model: Option<String>,
    pub permission_mode: Option<String>,
    pub automation_run_id: Option<String>,
    /// Fixed at creation; see `Chat::temporary`.
    pub temporary: bool,
    /// `<data_dir>/scratch` — the root the repository appends the minted chat
    /// id under. Only meaningful when `project_id == NO_PROJECT_ID`; ignored
    /// otherwise.
    pub scratch_root: Option<String>,
}

/// Per-chat / per-session tuning override. Tri-state per field:
///   absent (`None`)         → not part of this partial (PATCH); leave as-is
///   present null (`Some(None)`) → explicitly inherit (provider → model default)
///   present value           → concrete override
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTuning {
    #[serde(
        default,
        deserialize_with = "crate::serde_util::double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub effort: Option<Option<EffortLevel>>,
    #[serde(
        default,
        deserialize_with = "crate::serde_util::double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub fast: Option<Option<bool>>,
    #[serde(
        default,
        deserialize_with = "crate::serde_util::double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub ultracode: Option<Option<bool>>,
    #[serde(
        default,
        deserialize_with = "crate::serde_util::double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub adaptive_thinking: Option<Option<bool>>,
}

/// Fully resolved, capability-clamped config. `effort: null` → model has no
/// effort control.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedTuning {
    pub effort: Option<EffortLevel>,
    pub fast: bool,
    pub ultracode: bool,
    pub adaptive_thinking: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatStatus {
    #[default]
    Active,
    Paused,
    Ended,
    Archived,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProcessState {
    Working,
    Idle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DisplayStatus {
    Idle,
    Working,
    Waiting,
}

pub use wire::Chat;
mod wire;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: String,
    pub last_opened_at: String,
    #[serde(
        default,
        deserialize_with = "crate::serde_util::double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub parent_project_id: Option<Option<String>>,
    /// Derived on read by stat-ing `path`; never persisted, absent on responses that
    /// do not derive it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub available: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatMessageType {
    User,
    Assistant,
    ToolUse,
    ToolResult,
    Permission,
    System,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub chat_id: String,
    pub r#type: ChatMessageType,
    pub content: Vec<MessageContent>,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub old_start: i64,
    pub old_lines: i64,
    pub new_start: i64,
    pub new_lines: i64,
    pub lines: Vec<String>,
}

/// Transcript-form content union. `parentToolUseId` tags a block as originating
/// from a subagent stream event; it is present on every variant (see the TS
/// note on `MessageContent`).
///
/// Untagged wrapper composing the shared `LeafContent` with the transcript-only
/// node variants; both sub-sets are internally tagged on disjoint `type` values,
/// so deserialization is unambiguous while `LeafContent` stays shared with
/// `DisplayContent`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    Leaf(LeafContent),
    Node(MessageContentNode),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum MessageContentNode {
    ToolUse {
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "crate::tool_call_timing::deserialize_optional"
        )]
        timing: Option<crate::tool_call_timing::ToolCallTiming>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        command_execution: Option<crate::command_execution::CommandExecutionMetadata>,
        id: String,
        name: String,
        input: HashMap<String, serde_json::Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },
    ToolResult {
        tool_use_id: String,
        content: String,
        is_error: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        structured_patch: Option<Vec<DiffHunk>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        original_file: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        modified_file: Option<String>,
        /// Base64 image blocks carried on the `tool_result`, in source
        /// order. Never serialized as text; omitted when empty.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        images: Vec<ToolResultImage>,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },
    PermissionRequest {
        request: ControlRequest,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },
    Error {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },
    Compaction {
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },
    /// The divider that opens every segment after a chat's first (provider
    /// switch, or a context reset on the same provider).
    ProviderSwitch {
        marker: crate::segment::ProviderSwitchMarker,
    },
}

/// Tracks a message that was sent to stdin while the CLI was busy.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedMessageRef {
    /// The display message ID (from `MessageCache`).
    pub message_id: String,
    pub chat_id: String,
    /// UUID sent to the CLI for cancel/tracking.
    pub uuid: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachment_ids: Option<Vec<String>>,
    pub timestamp: String,
}

#[cfg(test)]
mod tests;
