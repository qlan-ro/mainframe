//! Mainframe's `_mainframe.dev` extension namespace — everything ACP has no
//! construct for, riding `_meta` and `_`-prefixed custom methods per the
//! schema's extensibility discipline (ACP-EVALUATION.md "What to borrow" #6:
//! "a reserved `_meta` on every frame, `_`-prefixed enum values reserved for
//! implementations, and the rule that unknown values must not be treated as
//! approval"). Every type here is opaque to core ACP — a client that doesn't
//! recognize the namespace ignores it and gets a degraded but coherent
//! experience (spec: "Generic ACP clients that advertise no Mainframe
//! capabilities get a degraded but coherent chat experience").

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::adapter::ControlResponse;
use crate::chat::DiffHunk;

/// The `_meta` key every extension value below is namespaced under.
pub const MAINFRAME_META_NAMESPACE: &str = "_mainframe.dev";

/// The CLI's own context-occupancy percentage, riding a `usage_update`'s
/// `_meta["_mainframe.dev"]`. Not derivable from `used`/`size`: the CLI
/// accounts for its usable-window buffer (autocompact headroom), and clients
/// that guessed from catalog windows historically pinned the meter at 100%.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageMeta {
    pub percentage: f64,
}

/// A slash-command invocation riding [`PromptSendMeta`] (formerly the legacy
/// `message.send` frame's `metadata.command`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageSendCommand {
    pub name: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<String>,
}

/// Display-fidelity payload riding every encoded item's
/// `_meta["_mainframe.dev"]` (desktop-cutover pass): the legacy
/// `DisplayMessage` context the core ACP item grammar has no field for.
/// Generic ACP clients ignore it; the Mainframe client reaggregates items
/// into per-container messages from `container_id` and renders timestamps,
/// attachments, cost, and error/system framing from the rest.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ItemMeta {
    /// The containing `DisplayMessage.timestamp` (ISO-8601).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    /// The containing `DisplayMessage.id` — the reaggregation key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub container_id: Option<String>,
    /// Subagent attribution: the launching Task tool call's id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_tool_call_id: Option<String>,
    /// Container refinement beyond user/agent roles (message items only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<ItemContainerKind>,
    /// An error container's message (`DisplayNode::Error`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_text: Option<String>,
    /// A system container's skill-load record (`LeafContent::SkillLoaded`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skill_loaded: Option<SkillLoadedMeta>,
    /// True when the system container carries a compaction marker.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_compacted: Option<bool>,
    /// The containing `DisplayMessage.metadata` map, passed through verbatim
    /// (attachments, command, cost_usd, turnDurationMs, …) — the same data
    /// the legacy dialect already serializes on every display frame.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_meta: Option<HashMap<String, Value>>,
    /// The daemon's `tool_group` membership: members share the first
    /// member's id as their group id (tool-call items only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    /// True on the tool-call item that represents a subagent task group —
    /// its `title` is the task description, not a tool name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subagent: Option<bool>,
}

/// [`ItemMeta::kind`] — `user`/`agent` ride the item role; these mark the
/// containers the role pair cannot express.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemContainerKind {
    System,
    Error,
}

/// [`ItemMeta::skill_loaded`] — mirrors `LeafContent::SkillLoaded`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillLoadedMeta {
    pub skill_name: String,
    pub path: String,
    pub content: String,
}

/// The send context a `session/prompt`'s `_meta["_mainframe.dev"]` carries
/// (desktop-cutover pass): uploaded attachment ids and the slash-command
/// invocation — the two fields the legacy `message.send` frame carried that
/// the core ACP prompt has no construct for.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PromptSendMeta {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachment_ids: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<MessageSendCommand>,
}

/// Mainframe's agent-capabilities extension, advertised in `initialize`'s
/// response under `_meta["_mainframe.dev"]`. Generic ACP clients see none of
/// these keys and degrade gracefully (spec: "option-only gates, no
/// queued-turn metadata").
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MainframeCapabilities {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rich_permission_answers: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub queued_prompts: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_markers: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub heartbeat_interval_ms: Option<i64>,
}

/// `api_retry` modeled as a content-replacing patch plus this marker (spec
/// decision 10), riding a message/tool-call upsert's `_meta["_mainframe.dev"]`
/// alongside the replaced `content` — never a distinct lifecycle frame.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryMarker {
    pub attempt: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Queued-prompt state (spec decision 11): an ordinary accepted prompt's
/// `PromptResponse._meta["_mainframe.dev"]` carries this while the prompt
/// waits for its turn. No `queue.*` frame family exists on the facade.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedPromptState {
    pub position: i64,
}

/// The rich permission answer (spec decision 12): today's `ControlResponse`
/// semantics (input mutation, suggestion rules, execution mode, clear
/// context), reused verbatim per the single-canonical-type rule rather than
/// redefined for the facade. Rides `RequestPermissionResponse._meta
/// ["_mainframe.dev"]` alongside the plain `{outcome, optionId}` answer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RichPermissionAnswer {
    pub control_response: ControlResponse,
}

/// The fidelity payload a `diff` tool-call content entry carries in its own
/// `_meta["_mainframe.dev"]` (spec Decision 15): the legacy display
/// pipeline's structured hunks plus the full before/after file text —
/// neither survives a round trip through git-patch text (the full files
/// aren't in it at all), and the desktop Edit/Write cards consume exactly
/// this shape (`mapToolResult`). Generic ACP clients ignore it and render
/// the sibling `patch` text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuredDiff {
    pub structured_patch: Vec<DiffHunk>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified_file: Option<String>,
}

/// Params for the daemon's custom `_mainframe.dev/heartbeat` notification
/// (spec decision 13: "heartbeat plus resume-replay is the documented rule").
/// `sequence` lets a client detect a gap (a jump larger than one) and resume
/// instead of heuristically refetching.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatParams {
    pub sequence: u64,
}

/// `_mainframe.dev/compaction`'s params: live compaction progress for a
/// session (`chat.compacting`/`chat.compactDone`'s facade successor). The
/// transcript's durable compaction marker rides `ItemMeta::is_compacted`;
/// this notification only drives the in-flight indicator.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionParams {
    pub session_id: String,
    pub phase: CompactionWirePhase,
}

/// [`CompactionParams::phase`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompactionWirePhase {
    Started,
    Done,
}

/// Params for the daemon's custom `_mainframe.dev/gate_resolved` notification
/// (spec decision 19): pushed to every attached connection still holding the
/// gate when it resolves elsewhere — another facade client's answer, a
/// legacy-surface answer, or the CLI cancelling it — so a pending gate clears
/// immediately instead of on the next resume. `requestId` is the JSON-RPC id
/// the gate's `session/request_permission` traveled under (`gate-{id}`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateResolvedParams {
    pub session_id: String,
    pub request_id: String,
}

/// The marker a truncated tool-result text block carries in its own
/// `_meta["_mainframe.dev"]` (spec decision 20): the legacy display
/// pipeline's `truncated`/`fullBytes` pair (`truncate_tool_content`), which
/// the joined content text cannot express — clients use it to offer the
/// on-demand full-output fetch (`GET /api/chats/{id}/tool-result/{toolUseId}`),
/// the same affordance the legacy dialect's `ToolCallResult` carries inline.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TruncationMarker {
    pub truncated: bool,
    pub full_bytes: i64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn capabilities_omit_all_absent_fields() {
        let caps = MainframeCapabilities {
            rich_permission_answers: None,
            queued_prompts: None,
            retry_markers: None,
            heartbeat_interval_ms: None,
        };
        assert_eq!(serde_json::to_value(caps).unwrap(), json!({}));
    }
}
