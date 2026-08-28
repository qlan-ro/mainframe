//! Tool calls: the `ToolCallUpdate` upsert/patch (schema: "Only `toolCallId`
//! is required. Other fields have patch semantics: omitted fields leave the
//! existing tool call value unchanged, `null` clears or unsets the value, and
//! concrete values replace the previous value") and its streamed-append
//! sibling `ToolCallContentChunk`. `ToolCallContent` is scoped to the
//! `content` (block) variant — `diff`/`terminal` are deferred (see decisions:
//! v2's `Diff` grew a structured `DiffChange[]` shape beyond v1's flat
//! `{path, oldText, newText}`, and `terminal` content is moot without the
//! declined `terminal/*` client services).

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::content::ContentBlock;
use super::patch;

pub type ToolCallId = String;

/// Schema `ToolKind` — a tool taxonomy shared across ACP's whole agent
/// ecosystem (ACP-EVALUATION.md "What to borrow" #2), adopted verbatim in
/// place of Mainframe's ad hoc `explore`/`hidden`/`progress`/`subagent` split.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolKind {
    Read,
    Edit,
    Delete,
    Move,
    Search,
    Execute,
    Think,
    Fetch,
    SwitchMode,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolCallStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallLocation {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ToolCallContent {
    Content { content: ContentBlock },
}

/// Tool-call upsert/patch. Every field but `toolCallId` uses the
/// `Option<Option<T>>` double-Option pattern (`patch.rs`) so omitted, `null`,
/// and value-present are all distinguishable on the wire.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallUpdate {
    pub tool_call_id: ToolCallId,
    #[serde(default, skip_serializing_if = "patch::is_absent", with = "patch")]
    pub title: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "patch::is_absent", with = "patch")]
    pub kind: Option<Option<ToolKind>>,
    #[serde(default, skip_serializing_if = "patch::is_absent", with = "patch")]
    pub status: Option<Option<ToolCallStatus>>,
    #[serde(default, skip_serializing_if = "patch::is_absent", with = "patch")]
    pub content: Option<Option<Vec<ToolCallContent>>>,
    #[serde(default, skip_serializing_if = "patch::is_absent", with = "patch")]
    pub locations: Option<Option<Vec<ToolCallLocation>>>,
    #[serde(default, skip_serializing_if = "patch::is_absent", with = "patch")]
    pub raw_input: Option<Option<Value>>,
    #[serde(default, skip_serializing_if = "patch::is_absent", with = "patch")]
    pub raw_output: Option<Option<Value>>,
    #[serde(
        default,
        skip_serializing_if = "patch::is_absent",
        with = "patch",
        rename = "_meta"
    )]
    pub meta: Option<Option<Value>>,
}

/// One appended item of tool-call content — the `tool_call_content_chunk`
/// `session/update` payload. Unlike `ToolCallUpdate.content` (a full-array
/// replace), this always appends one item to the tool call's existing
/// content.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallContentChunk {
    pub tool_call_id: ToolCallId,
    pub content: ToolCallContent,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "_meta")]
    pub meta: Option<Value>,
}
