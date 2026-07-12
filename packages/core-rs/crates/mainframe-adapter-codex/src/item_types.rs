//! Ported from `packages/core/src/plugins/builtin/codex/item-types.ts`.
//!
//! `ThreadItem` union and all item-specific structs for the Codex protocol. These
//! are INTERNAL to this crate (crate-map §2.8 `types.ts` note) — they deserialize
//! from Codex app-server JSON-RPC payloads, so field names track Codex's camelCase
//! (except `move_path`, which Codex emits snake_case) and unknown fields are
//! tolerated (serde ignores them, matching the TS structural typing).

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// `ThreadItem` — the tagged union of every item type Codex streams. Statuses stay
/// `String` (not enums) to mirror the TS string-literal comparisons and tolerate
/// unknown Codex status values without failing the whole item.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ThreadItem {
    AgentMessage(AgentMessageItem),
    Reasoning(ReasoningItem),
    CommandExecution(CommandExecutionItem),
    FileChange(FileChangeItem),
    McpToolCall(McpToolCallItem),
    WebSearch(WebSearchItem),
    ImageGeneration(ImageGenerationItem),
    TodoList(TodoListItem),
    UserMessage(UserMessageItem),
    CollabAgentToolCall(CollabAgentToolCallItem),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessageItem {
    pub id: String,
    pub text: String,
    pub phase: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReasoningItem {
    pub id: String,
    pub summary: Vec<String>,
    pub content: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecutionItem {
    pub id: String,
    pub command: String,
    pub aggregated_output: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i64>,
    pub status: String,
}

/// Matches `PatchChangeKind` from the v2 schema (tagged union with optional
/// `move_path`). Codex emits `move_path` snake_case, so the field is NOT renamed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PatchChangeKind {
    Add,
    Delete,
    Update { move_path: Option<String> },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub kind: PatchChangeKind,
    pub diff: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeItem {
    pub id: String,
    pub changes: Vec<FileChange>,
    /// `PatchApplyStatus` — kept `String` to mirror the TS string comparisons.
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolResult {
    #[serde(default)]
    pub content: serde_json::Value,
    #[serde(default)]
    pub structured_content: serde_json::Value,
    #[serde(rename = "_meta", default)]
    pub meta: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CodexItemError {
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolCallItem {
    pub id: String,
    #[serde(default)]
    pub server: Option<String>,
    pub tool: String,
    #[serde(default)]
    pub arguments: HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub result: Option<McpToolResult>,
    #[serde(default)]
    pub error: Option<CodexItemError>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_app_resource_uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchItem {
    pub id: String,
    pub query: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageGenerationItem {
    pub id: String,
    /// Base64-encoded image bytes (PNG). Always present in completed events.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    /// Filesystem path where Codex saved the generated image.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub saved_path: Option<String>,
    /// The model's revised version of the user's prompt, if available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revised_prompt: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoEntry {
    pub text: String,
    pub completed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoListItem {
    pub id: String,
    pub items: Vec<TodoEntry>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserContentBlock {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_elements: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserMessageItem {
    pub id: String,
    /// Codex 0.125 stores the prompt under `content[].text`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<Vec<UserContentBlock>>,
    /// Older variants may include a top-level `text` field; tolerate both.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStateEntry {
    pub status: String,
    pub message: Option<String>,
}

/// Codex 0.125+ emits each sub-agent delegation as TWO `collabAgentToolCall`
/// items: `tool: "spawnAgent"` (dispatch metadata; carries the prompt +
/// `receiverThreadIds`) and `tool: "wait"` (the renderable card; carries the
/// sub-agent output in `agentsStates[childThreadId].message`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollabAgentToolCallItem {
    pub id: String,
    /// "spawnAgent" or "wait".
    pub tool: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sender_thread_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub receiver_thread_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
    /// Per-child status snapshot. For `wait` items, contains the final `message`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agents_states: Option<HashMap<String, AgentStateEntry>>,
}

// PORT STATUS: src/plugins/builtin/codex/item-types.ts (119 lines)
// confidence: high
// todos: 0
// notes: ThreadItem is internally tagged on "type" with serde camelCase variant
// notes: names (AgentMessage -> "agentMessage", etc.). Item statuses are String
// notes: (not enums) to mirror the TS string-literal comparisons and tolerate
// notes: unknown Codex status values. PatchChangeKind keeps `move_path` snake_case
// notes: (Codex emits it snake) by NOT applying rename_all_fields. Internal to the
// notes: crate (deserialize from Codex JSON-RPC), not daemon wire types.
