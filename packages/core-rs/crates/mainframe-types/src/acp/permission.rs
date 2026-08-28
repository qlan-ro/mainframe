//! `session/request_permission` — a mid-turn blocking request while updates
//! keep streaming (spec: "Gates remain mid-turn blocking requests... while
//! updates keep streaming"). The adapter supplies an ordered option list
//! (ACP-EVALUATION.md "What to borrow" #4); a plain `{outcome:"selected",
//! optionId}` answer is always valid, and Mainframe-aware clients attach a
//! rich answer under `_meta["_mainframe.dev"]`
//! (`extensions::RichPermissionAnswer`) carrying today's `ControlResponse`
//! semantics — see `extensions.rs`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::session::SessionId;
use super::tool_call::ToolCallUpdate;

pub type PermissionOptionId = String;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionOptionKind {
    AllowOnce,
    AllowAlways,
    RejectOnce,
    RejectAlways,
}

/// One option the client may pick (schema `PermissionOption`). The client
/// must not infer a permission's effect from `kind` or `name` — the
/// daemon/adapter owns the effect (spec: "Clients must not infer a
/// permission's effect from option kind or label").
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionOption {
    pub option_id: PermissionOptionId,
    pub name: String,
    pub kind: PermissionOptionKind,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "_meta")]
    pub meta: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallPermissionSubject {
    pub tool_call: ToolCallUpdate,
}

/// The operation requiring permission (schema `RequestPermissionSubject`),
/// scoped to the `tool_call` variant — `command` (a bare-shell-command
/// subject with no associated tool call) has no producer here: every
/// Mainframe gate originates from an adapter `ControlRequest` bound to a
/// tool use (spec Decision 18).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RequestPermissionSubject {
    ToolCall(ToolCallPermissionSubject),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestPermissionRequest {
    pub session_id: SessionId,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject: Option<RequestPermissionSubject>,
    pub options: Vec<PermissionOption>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "_meta")]
    pub meta: Option<Value>,
}

/// The outcome of a permission request (schema `RequestPermissionOutcome`).
/// `Cancelled` is mandated on `session/cancel` — the client MUST answer every
/// open request this way (spec edge cases; schema `RequestPermissionOutcome`
/// docs).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all_fields = "camelCase")]
pub enum RequestPermissionOutcome {
    #[serde(rename = "cancelled")]
    Cancelled,
    #[serde(rename = "selected")]
    Selected { option_id: PermissionOptionId },
}

/// The plain ACP answer is `{outcome}` alone. A rich Mainframe answer adds
/// `_meta["_mainframe.dev"]` carrying `extensions::RichPermissionAnswer` —
/// both are the same wire type here; the daemon reads `meta` to tell them
/// apart (spec acceptance criterion 8).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestPermissionResponse {
    pub outcome: RequestPermissionOutcome,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "_meta")]
    pub meta: Option<Value>,
}
