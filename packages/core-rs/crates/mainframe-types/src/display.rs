use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::adapter::ControlRequest;
use crate::chat::DiffHunk;
use crate::claude_workflow::ClaudeWorkflowRun;
use crate::content::{LeafContent, ToolResultImage};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskUserQuestionAnswer {
    pub question: String,
    pub answer: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallResult {
    pub content: String,
    pub is_error: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub structured_patch: Option<Vec<DiffHunk>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub truncated: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full_bytes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ask_user_question: Option<Vec<AskUserQuestionAnswer>>,
    /// Base64 image blocks carried on the tool result, in source
    /// order. Not subject to text truncation; omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<ToolResultImage>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCategories {
    pub explore: HashSet<String>,
    pub hidden: HashSet<String>,
    pub progress: HashSet<String>,
    pub subagent: HashSet<String>,
}

/// Display category assigned to a rendered tool call.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolCategory {
    Default,
    Explore,
    Hidden,
    Progress,
    Subagent,
}

/// Which leaf kind the partial-message overlay currently backs. An in-process
/// contract between `emit_display_for` and
/// `mainframe_acp::encoder::encode_revision` — never serialized, since the
/// wire only ever sees the resulting `ItemMeta.streaming: bool`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamingLeafKind {
    Text,
    Thinking,
}

/// UI-render-form content union. Untagged wrapper composing the shared
/// `LeafContent` with the display-only node variants; both sub-sets are
/// internally tagged on disjoint `type` values, so `LeafContent` stays shared
/// with `MessageContent` while deserialization is unambiguous.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
#[expect(
    clippy::large_enum_variant,
    reason = "Inline display nodes avoid allocating every non-leaf content block; command metadata is already boxed"
)]
pub enum DisplayContent {
    Leaf(LeafContent),
    Node(DisplayNode),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum DisplayNode {
    ToolCall {
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "crate::tool_call_timing::deserialize_optional"
        )]
        timing: Option<crate::tool_call_timing::ToolCallTiming>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        command_execution: Option<Box<crate::command_execution::CommandExecutionMetadata>>,
        id: String,
        name: String,
        input: HashMap<String, serde_json::Value>,
        category: ToolCategory,
        #[serde(skip_serializing_if = "Option::is_none")]
        result: Option<ToolCallResult>,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },
    ToolGroup {
        calls: Vec<DisplayContent>,
    },
    TaskGroup {
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "crate::tool_call_timing::deserialize_optional"
        )]
        timing: Option<crate::tool_call_timing::ToolCallTiming>,
        agent_id: String,
        task_args: HashMap<String, serde_json::Value>,
        calls: Vec<DisplayContent>,
        #[serde(skip_serializing_if = "Option::is_none")]
        result: Option<ToolCallResult>,
    },
    TaskProgress {
        items: Vec<TaskProgressItem>,
    },
    PermissionRequest {
        request: ControlRequest,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },
    Error {
        message: String,
    },
    Compaction {
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },
    ProviderSwitch {
        marker: crate::segment::ProviderSwitchMarker,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskProgressItem {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::tool_call_timing::deserialize_optional"
    )]
    pub timing: Option<crate::tool_call_timing::ToolCallTiming>,
    pub id: String,
    pub name: String,
    pub input: HashMap<String, serde_json::Value>,
    pub category: ToolCategory,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<ToolCallResult>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DisplayMessageType {
    User,
    Assistant,
    System,
    Error,
    Permission,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayMessage {
    pub id: String,
    pub chat_id: String,
    pub r#type: DisplayMessageType,
    pub content: Vec<DisplayContent>,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

/// GET /api/chats/:id/messages payload — `transcriptMissing` distinguishes a
/// genuinely empty thread from one whose CLI transcript was deleted from disk.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistoryPayload {
    pub messages: Vec<DisplayMessage>,
    pub transcript_missing: bool,
    #[serde(default)]
    pub workflow_runs: Vec<ClaudeWorkflowRun>,
}

/// True when metadata carries a non-empty `attachments` (live preview) or
/// `attachedFiles` (replay-parsed) array — the signal the display and encoder
/// gates use to keep an attachment-only user turn alive despite empty content.
pub fn has_attachment_evidence(metadata: Option<&HashMap<String, serde_json::Value>>) -> bool {
    ["attachments", "attachedFiles"].iter().any(|key| {
        metadata
            .and_then(|m| m.get(*key))
            .and_then(|v| v.as_array())
            .is_some_and(|a| !a.is_empty())
    })
}

#[cfg(test)]
#[path = "display_tests.rs"]
mod tests;
