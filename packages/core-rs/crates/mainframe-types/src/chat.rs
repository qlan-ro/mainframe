//! Ported from `packages/types/src/chat.ts`.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::adapter::{ControlRequest, DetectedPr, EffortLevel};
use crate::content::LeafContent;
use crate::context::SessionMention;
use crate::settings::ExecutionMode;

/// Deserialize a `field?: X | null` into the absent/null/value tri-state.
///
/// serde only invokes this when the key is present, so absent → `default`
/// (`None`); present-null → `Some(None)`; present-value → `Some(Some(v))`. The
/// plain `Option<Option<T>>` deserializer instead collapses null to the outer
/// `None`, losing the explicit-null case.
fn double_option<'de, D, T>(de: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    serde::Deserialize::deserialize(de).map(Some)
}

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

/// Back-compat alias for existing imports.
pub type ChatEffort = EffortLevel;

/// Per-chat / per-session tuning override. Tri-state per field:
///   absent (`None`)         → not part of this partial (PATCH); leave as-is
///   present null (`Some(None)`) → explicitly inherit (provider → model default)
///   present value           → concrete override
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTuning {
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub effort: Option<Option<EffortLevel>>,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub fast: Option<Option<bool>>,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub ultracode: Option<Option<bool>>,
    #[serde(
        default,
        deserialize_with = "double_option",
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatStatus {
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chat {
    pub id: String,
    pub adapter_id: String,
    pub project_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claude_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<ExecutionMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_mode: Option<bool>,
    pub status: ChatStatus,
    pub created_at: String,
    pub updated_at: String,
    pub total_cost: f64,
    pub total_tokens_input: i64,
    pub total_tokens_output: i64,
    pub last_context_tokens_input: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_files: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mentions: Option<Vec<SessionMention>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_files: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_name: Option<String>,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub process_state: Option<Option<ProcessState>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_status: Option<DisplayStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_running: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_missing: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub todos: Option<Vec<TodoItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub effort: Option<Option<EffortLevel>>,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub fast: Option<Option<bool>>,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub ultracode: Option<Option<bool>>,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub adaptive_thinking: Option<Option<bool>>,
    /// PRs detected in the session's tool_results.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detected_prs: Option<Vec<DetectedPr>>,
    /// User-source tags applied to this chat (synthetic chips excluded).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
}

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
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub parent_project_id: Option<Option<String>>,
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
    fn todo_status_snake_case() {
        roundtrip::<TodoItem>(json!({
            "content": "Ship the fix",
            "status": "in_progress",
            "activeForm": "Shipping the fix"
        }));
    }

    #[test]
    fn session_tuning_tristate() {
        // absent → None → omitted on the way back out
        let s = serde_json::to_string(&SessionTuning::default()).unwrap();
        assert_eq!(s, "{}");
        // present null → Some(None) → serializes null
        let v = json!({ "effort": null, "fast": true });
        roundtrip::<SessionTuning>(v.clone());
        let t: SessionTuning = serde_json::from_value(v).unwrap();
        assert_eq!(t.effort, Some(None));
        assert_eq!(t.fast, Some(Some(true)));
        // present value → Some(Some(v))
        roundtrip::<SessionTuning>(json!({ "effort": "high" }));
    }

    #[test]
    fn chat_effort_null_roundtrips() {
        // effort present-null must survive as null on the wire.
        let v = json!({
            "id": "chat_1",
            "adapterId": "claude",
            "projectId": "proj_1",
            "status": "active",
            "createdAt": "t",
            "updatedAt": "t",
            "totalCost": 0.0,
            "totalTokensInput": 0,
            "totalTokensOutput": 0,
            "lastContextTokensInput": 0,
            "effort": null
        });
        roundtrip::<Chat>(v);
    }

    #[test]
    fn project_null_parent_present() {
        // parentProjectId present as null (fixture route.projects-list) must
        // round-trip as null, not be omitted.
        roundtrip::<Project>(json!({
            "id": "proj_a1b2c3",
            "name": "mainframe",
            "path": "/Users/doru/Projects/mainframe",
            "createdAt": "2026-07-08T10:15:30.000Z",
            "lastOpenedAt": "2026-07-08T10:16:12.500Z",
            "parentProjectId": null
        }));
    }

    #[test]
    fn message_content_leaf_and_node() {
        // Leaf arm
        roundtrip::<MessageContent>(json!({ "type": "text", "text": "hi" }));
        // Node arm: tool_result with structuredPatch
        roundtrip::<MessageContent>(json!({
            "type": "tool_result",
            "toolUseId": "toolu_01A",
            "content": "4\n",
            "isError": false,
            "structuredPatch": [
                { "oldStart": 1, "oldLines": 1, "newStart": 1, "newLines": 1, "lines": [" 4"] }
            ],
            "originalFile": "a.txt",
            "modifiedFile": "a.txt"
        }));
        // Node arm: tool_use
        roundtrip::<MessageContent>(json!({
            "type": "tool_use",
            "id": "toolu_01A",
            "name": "Bash",
            "input": { "command": "echo 4" }
        }));
    }

    #[test]
    fn queued_message_ref_minimal_and_full() {
        roundtrip::<QueuedMessageRef>(json!({
            "messageId": "dmsg_0003",
            "chatId": "chat_9f2a3b1c",
            "uuid": "a1b2c3d4",
            "content": "Continue with the fix",
            "timestamp": "2026-07-08T10:15:30.000Z"
        }));
        roundtrip::<QueuedMessageRef>(json!({
            "messageId": "dmsg_0003",
            "chatId": "chat_9f2a3b1c",
            "uuid": "a1b2c3d4",
            "content": "Continue with the fix",
            "timestamp": "2026-07-08T10:15:30.000Z",
            "attachmentIds": ["att_001", "att_002"]
        }));
    }
}

// PORT STATUS: packages/types/src/chat.ts (140 lines)
// confidence: high
// todos: 0
// notes: `?: X | null` fields (Chat.processState/effort/fast/ultracode/
// adaptiveThinking, Project.parentProjectId, SessionTuning.*) use
// Option<Option<T>> + #[serde(default, skip_serializing_if=Option::is_none)] to
// preserve the absent/null/value tri-state faithfully (route.projects-list
// fixture shows parentProjectId present as null); deserialize_with="double_option"
// is required because plain Option<Option<T>> collapses null to the outer None.
// WIRE NOTE (Phase B): Chat.totalCost is f64 (0.0842 in fixtures); serde_json
// renders a whole-valued f64 as `0.0` whereas Node's JSON.stringify emits `0`.
// Semantically identical (JS coerces) but byte-differs — verify against the live
// Node output in the differential harness. ChatEffort is a type alias to
// adapter::EffortLevel. MessageContent is an untagged wrapper over shared
// LeafContent (content.rs) + transcript-only MessageContentNode (internally
// tagged, disjoint tags). ToolResultMessageContent (TS Extract alias) has no
// standalone Rust type — consumers match MessageContentNode::ToolResult.
// References crate::{content,adapter,context,settings}.
