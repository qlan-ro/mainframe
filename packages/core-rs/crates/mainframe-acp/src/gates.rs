//! Permission gates on the facade (todo #350, plan task 16): build the
//! daemon-initiated `session/request_permission` request from a
//! `ControlRequest`, and parse the client's answer back into a
//! `ControlResponse` — today's semantics, reused verbatim per the
//! single-canonical-type rule.
//!
//! `session/request_permission` is a request the *daemon* sends to the
//! client (mid-turn, blocking) — the reverse direction from `session/prompt`.
//! An answer arrives as `rpc::InboundFrame::Response`, already classified by
//! group C's codec; this module only converts between it and `ControlRequest`/
//! `ControlResponse`, not the correlation of a reply to its request (that is
//! `mainframe-server`'s socket-loop concern, out of this crate's scope per
//! the module doc in `lib.rs`).

use mainframe_types::acp::extensions::{MAINFRAME_META_NAMESPACE, RichPermissionAnswer};
use mainframe_types::acp::jsonrpc::{JsonRpcRequest, RequestId};
use mainframe_types::acp::permission::{
    PermissionOption, PermissionOptionKind, RequestPermissionOutcome, RequestPermissionRequest,
    RequestPermissionResponse, RequestPermissionSubject, ToolCallPermissionSubject,
};
use mainframe_types::acp::tool_call::ToolCallUpdate;
use mainframe_types::adapter::{ControlBehavior, ControlRequest, ControlResponse};

pub const OPTION_ALLOW_ONCE: &str = "allow-once";
pub const OPTION_ALLOW_ALWAYS: &str = "allow-always";
pub const OPTION_REJECT_ONCE: &str = "reject-once";

/// The client must not infer a permission's effect from an option's `kind`/
/// `name` (spec: "the daemon/adapter owns the effect") — this fixed set is
/// the only vocabulary `parse_answer` recognizes for a plain answer; anything
/// else falls through to [`GateAnswerError::UnknownOption`].
fn offered_options() -> Vec<PermissionOption> {
    vec![
        PermissionOption {
            option_id: OPTION_ALLOW_ONCE.into(),
            name: "Allow once".into(),
            kind: PermissionOptionKind::AllowOnce,
            meta: None,
        },
        PermissionOption {
            option_id: OPTION_ALLOW_ALWAYS.into(),
            name: "Always allow".into(),
            kind: PermissionOptionKind::AllowAlways,
            meta: None,
        },
        PermissionOption {
            option_id: OPTION_REJECT_ONCE.into(),
            name: "Reject".into(),
            kind: PermissionOptionKind::RejectOnce,
            meta: None,
        },
    ]
}

fn subject_for(request: &ControlRequest) -> RequestPermissionSubject {
    RequestPermissionSubject::ToolCall(ToolCallPermissionSubject {
        tool_call: ToolCallUpdate {
            tool_call_id: request.tool_use_id.clone(),
            title: Some(Some(request.tool_name.clone())),
            kind: None,
            status: None,
            content: None,
            locations: None,
            raw_input: None,
            raw_output: None,
            meta: None,
        },
    })
}

/// The JSON-RPC request id a `session/request_permission` for `request_id`
/// travels under — one scheme shared by the live raise path (the facade hub)
/// and resume redelivery, so a client answering a redelivered gate correlates
/// against the same id it would have seen live.
pub fn gate_request_id(request_id: &str) -> RequestId {
    RequestId::Str(format!("gate-{request_id}"))
}

/// Build the `session/request_permission` request a facade connection sends
/// the client. `id` is the JSON-RPC request id the caller correlates the
/// answer against — this function stays agnostic to how that id is chosen.
pub fn build_request(session_id: &str, id: RequestId, request: &ControlRequest) -> JsonRpcRequest {
    let payload = RequestPermissionRequest {
        session_id: session_id.to_string(),
        title: format!("Allow {} to run?", request.tool_name),
        description: None,
        subject: Some(subject_for(request)),
        options: offered_options(),
        meta: None,
    };
    JsonRpcRequest {
        jsonrpc: "2.0".into(),
        id: Some(id),
        method: "session/request_permission".into(),
        params: Some(serde_json::to_value(payload).unwrap_or(serde_json::Value::Null)),
    }
}

/// A permission answer this module could not turn into a `ControlResponse`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GateAnswerError {
    /// `session/cancel` mandates a `cancelled` outcome for every open
    /// request; the caller's job (not this function's) is to route it as a
    /// cancellation rather than a session-level answer.
    Cancelled,
    /// An `optionId` outside [`offered_options`] — never treated as
    /// approval (spec: "unknown extension values never treated as
    /// approval").
    UnknownOption(String),
}

/// Parse a `session/request_permission` answer for `request` into today's
/// `ControlResponse`. A rich `_mainframe.dev` answer (full `ControlResponse`
/// semantics: input mutation, execution mode, clear-context) is validated
/// against the request it answers before being trusted; a plain
/// `{outcome:"selected", optionId}` answer maps through [`offered_options`].
pub fn parse_answer(
    request: &ControlRequest,
    response: RequestPermissionResponse,
) -> Result<ControlResponse, GateAnswerError> {
    let RequestPermissionOutcome::Selected { option_id } = &response.outcome else {
        return Err(GateAnswerError::Cancelled);
    };

    if let Some(rich) = rich_answer(request, &response) {
        return Ok(rich);
    }

    let behavior = match option_id.as_str() {
        OPTION_ALLOW_ONCE | OPTION_ALLOW_ALWAYS => ControlBehavior::Allow,
        OPTION_REJECT_ONCE => ControlBehavior::Deny,
        other => return Err(GateAnswerError::UnknownOption(other.to_string())),
    };

    Ok(ControlResponse {
        request_id: request.request_id.clone(),
        tool_use_id: request.tool_use_id.clone(),
        tool_name: Some(request.tool_name.clone()),
        behavior,
        updated_input: None,
        updated_permissions: None,
        message: None,
        execution_mode: None,
        clear_context: None,
    })
}

/// A rich answer is validated against the request it claims to resolve — a
/// mismatched `requestId`/`toolUseId` is dropped in favor of the plain
/// `optionId` mapping rather than trusted as-is, so a stale or forged rich
/// answer can't resolve a different pending gate.
fn rich_answer(
    request: &ControlRequest,
    response: &RequestPermissionResponse,
) -> Option<ControlResponse> {
    let meta = response.meta.as_ref()?.get(MAINFRAME_META_NAMESPACE)?;
    let rich: RichPermissionAnswer = serde_json::from_value(meta.clone()).ok()?;
    let control = rich.control_response;
    if control.request_id != request.request_id || control.tool_use_id != request.tool_use_id {
        return None;
    }
    Some(control)
}

#[cfg(test)]
mod tests;
