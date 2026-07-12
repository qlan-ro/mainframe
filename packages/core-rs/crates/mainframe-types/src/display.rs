//! Ported from `packages/types/src/display.ts`.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::adapter::ControlRequest;
use crate::chat::DiffHunk;
use crate::content::LeafContent;

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

/// UI-render-form content union. Untagged wrapper composing the shared
/// `LeafContent` with the display-only node variants; both sub-sets are
/// internally tagged on disjoint `type` values, so `LeafContent` stays shared
/// with `MessageContent` while deserialization is unambiguous.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
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
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskProgressItem {
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
    fn display_content_leaf_arm() {
        roundtrip::<DisplayContent>(json!({ "type": "text", "text": "Running tests..." }));
        roundtrip::<DisplayContent>(json!({ "type": "thinking", "thinking": "hmm" }));
    }

    #[test]
    fn display_content_tool_call_with_result() {
        roundtrip::<DisplayContent>(json!({
            "type": "tool_call",
            "id": "toolu_02B",
            "name": "Read",
            "input": { "file_path": "x.ts" },
            "category": "explore",
            "result": {
                "content": "export function f() {}",
                "isError": false,
                "truncated": false,
                "fullBytes": 512
            }
        }));
    }

    #[test]
    fn display_content_nested_groups() {
        roundtrip::<DisplayContent>(json!({
            "type": "tool_group",
            "calls": [
                { "type": "tool_call", "id": "t1", "name": "Grep", "input": { "pattern": "x" }, "category": "explore" }
            ]
        }));
        roundtrip::<DisplayContent>(json!({
            "type": "task_group",
            "agentId": "agent_1",
            "taskArgs": { "description": "Investigate flake" },
            "calls": [ { "type": "text", "text": "Looking into it." } ],
            "result": { "content": "done", "isError": false }
        }));
        roundtrip::<DisplayContent>(json!({
            "type": "task_progress",
            "items": [
                { "id": "t4", "name": "Bash", "input": { "command": "pnpm test" }, "category": "progress" }
            ]
        }));
    }

    #[test]
    fn display_content_permission_error_compaction() {
        roundtrip::<DisplayContent>(json!({
            "type": "permission_request",
            "request": {
                "requestId": "req_001",
                "toolName": "Bash",
                "toolUseId": "toolu_01A",
                "input": { "command": "rm -rf /tmp/scratch" },
                "suggestions": []
            }
        }));
        roundtrip::<DisplayContent>(json!({ "type": "error", "message": "Tool timed out" }));
        roundtrip::<DisplayContent>(json!({ "type": "compaction" }));
    }

    #[test]
    fn display_message_minimal() {
        roundtrip::<DisplayMessage>(json!({
            "id": "dmsg_0001",
            "chatId": "chat_9f2a3b1c",
            "type": "user",
            "content": [ { "type": "text", "text": "Running tests..." } ],
            "timestamp": "2026-07-08T10:15:30.000Z"
        }));
    }

    #[test]
    fn chat_history_payload_round_trips() {
        roundtrip::<ChatHistoryPayload>(json!({ "messages": [], "transcriptMissing": true }));
        roundtrip::<ChatHistoryPayload>(json!({
            "messages": [
                {
                    "id": "dmsg_0001",
                    "chatId": "chat_9f2a3b1c",
                    "type": "user",
                    "content": [ { "type": "text", "text": "hi" } ],
                    "timestamp": "2026-07-08T10:15:30.000Z"
                }
            ],
            "transcriptMissing": false
        }));
    }
}

// PORT STATUS: packages/types/src/display.ts (80 lines)
// confidence: high
// todos: 0
// notes: Main catch-up (#424): ChatHistoryPayload { messages, transcriptMissing }
// — the GET /api/chats/:id/messages `data` envelope (was a bare DisplayMessage[]).
// notes(orig): DisplayContent is an untagged wrapper over shared LeafContent
// (content.rs) + display-only DisplayNode (internally tagged on tool_call/
// tool_group/task_group/task_progress/permission_request/error/compaction;
// disjoint from the leaf tags). ToolCategories uses HashSet<String> for the TS
// `Set<string>` fields. `type` fields use raw identifier `r#type` (serialize as
// "type"). full DisplayMessage validated by the events.rs golden round-trip of
// display.message.added. References crate::{content,chat,adapter}.
