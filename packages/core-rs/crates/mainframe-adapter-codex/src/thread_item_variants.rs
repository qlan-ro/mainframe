//! Payload structs for every `ThreadItem` variant (moved out of `item_types.rs` to
//! keep that file at just the enum + its serde attributes, per the 300-line rule).
//!
//! Field names track Codex's camelCase wire format (except `move_path`, which
//! Codex emits snake_case) and unknown fields are tolerated (serde ignores them).

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// Bare compaction marker (Codex 0.144.3 v2): `{ "type": "contextCompaction", "id" }`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextCompactionItem {
    pub id: String,
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

/// A live ping about a spawned sub-agent's activity, keyed by `agent_thread_id`
/// into the parent `CollabAgentToolCall`. Rendering (TaskCard updates) is B3
/// territory; this struct only lets the item round-trip through the union.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubAgentActivityItem {
    pub id: String,
    pub kind: String,
    pub agent_thread_id: String,
    pub agent_path: String,
}

/// One block of a `dynamicToolCall`'s `contentItems`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DynamicToolCallContentItem {
    InputText { text: String },
    InputImage { image_url: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicToolCallItem {
    pub id: String,
    #[serde(default)]
    pub namespace: Option<String>,
    pub tool: String,
    #[serde(default)]
    pub arguments: serde_json::Value,
    pub status: String,
    #[serde(default)]
    pub content_items: Option<Vec<DynamicToolCallContentItem>>,
    #[serde(default)]
    pub success: Option<bool>,
    #[serde(default)]
    pub duration_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnteredReviewModeItem {
    pub id: String,
    pub review: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExitedReviewModeItem {
    pub id: String,
    pub review: String,
}

/// `path` is Codex's `LegacyAppPathString`, which serializes as a plain string.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageViewItem {
    pub id: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SleepItem {
    pub id: String,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookPromptFragment {
    pub text: String,
    pub hook_run_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookPromptItem {
    pub id: String,
    pub fragments: Vec<HookPromptFragment>,
}
