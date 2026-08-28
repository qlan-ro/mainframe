//! `session/update` — the streaming notification and its `SessionUpdate`
//! payload variants. Internally tagged on `sessionUpdate`, mirroring the
//! `LeafContent`/`DaemonEvent` pattern already used in this crate
//! (`content.rs`, `events.rs`): each variant is a newtype wrapping a
//! dedicated struct, and `#[serde(rename_all = "snake_case")]` maps the Rust
//! variant name straight onto the schema's tag string (`ToolCallUpdate` →
//! `tool_call_update`).
//!
//! Scoped to the variants the chat facade's grammar (deltas, lifecycle,
//! usage) needs: message/thought chunks and upserts, tool-call
//! updates/chunks, foreground-state transitions, and usage. `terminal_*`
//! (declined, see tool_call.rs), `plan_update`, `available_commands_update`,
//! `config_option_update`, and `session_info_update` are not modeled — none
//! are in task 1's frame list.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::content::{ContentBlock, ContentChunk, MessageId};
use super::patch;
use super::session::SessionId;
use super::tool_call::{ToolCallContentChunk, ToolCallUpdate};

/// A user/agent message or agent-thought upsert (schema `AgentMessage` /
/// `AgentThought` / `UserMessage` — structurally identical). `content` is a
/// patch field: omitted leaves the accumulated content unchanged, `null`
/// clears it, and a value replaces it wholesale (chunks, not this variant,
/// are what append).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageUpsert {
    pub message_id: MessageId,
    #[serde(default, skip_serializing_if = "patch::is_absent", with = "patch")]
    pub content: Option<Option<Vec<ContentBlock>>>,
    #[serde(
        default,
        skip_serializing_if = "patch::is_absent",
        with = "patch",
        rename = "_meta"
    )]
    pub meta: Option<Option<Value>>,
}

/// Schema `StopReason` is `end_turn | max_tokens | max_turn_requests |
/// refusal | cancelled` plus an "other" catch-all reserved for `_`-prefixed
/// implementation extensions — it has **no built-in error reason**. The spec
/// requires one ("Turns end with an explicit stop reason (completed,
/// cancelled, **error**)"; edge case: "Adapter process dies mid-turn: the
/// turn ends with an error stop reason"), so `Error` is added here as that
/// extension, namespaced per the schema's own discipline.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    EndTurn,
    MaxTokens,
    MaxTurnRequests,
    Refusal,
    Cancelled,
    #[serde(rename = "_mainframe.dev/error")]
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdleStateUpdate {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<StopReason>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "_meta")]
    pub meta: Option<Value>,
}

/// Foreground-work state transition (schema `StateUpdate`). `Running` and
/// `RequiresAction` carry only an optional `_meta` upstream; this vendored
/// subset omits it on those two variants (nothing in the facade grammar needs
/// it there) and keeps it only on `Idle`, where `stopReason` lives.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum SessionState {
    Running,
    Idle(IdleStateUpdate),
    RequiresAction,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cost {
    pub amount: f64,
    pub currency: String,
}

/// Context-window occupancy plus cumulative cost (ACP-EVALUATION.md "What to
/// borrow" #5) — one event for both, replacing Mainframe's ad hoc
/// `chat.contextUsage`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageUpdate {
    pub used: u64,
    pub size: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost: Option<Cost>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "_meta")]
    pub meta: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "sessionUpdate", rename_all = "snake_case")]
pub enum SessionUpdate {
    UserMessageChunk(ContentChunk),
    UserMessage(MessageUpsert),
    AgentMessageChunk(ContentChunk),
    AgentMessage(MessageUpsert),
    AgentThoughtChunk(ContentChunk),
    AgentThought(MessageUpsert),
    StateUpdate(SessionState),
    ToolCallContentChunk(ToolCallContentChunk),
    ToolCallUpdate(ToolCallUpdate),
    UsageUpdate(UsageUpdate),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSessionNotification {
    pub session_id: SessionId,
    pub update: SessionUpdate,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "_meta")]
    pub meta: Option<Value>,
}
