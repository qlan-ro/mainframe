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

use std::collections::HashMap;

use mainframe_types::acp::extensions::{MAINFRAME_META_NAMESPACE, RichPermissionAnswer};
use mainframe_types::acp::jsonrpc::{JsonRpcRequest, RequestId};
use mainframe_types::acp::permission::{
    PermissionOption, PermissionOptionKind, RequestPermissionOutcome, RequestPermissionRequest,
    RequestPermissionResponse, RequestPermissionSubject, ToolCallPermissionSubject,
};
use mainframe_types::acp::tool_call::ToolCallUpdate;
use mainframe_types::adapter::{ControlBehavior, ControlRequest, ControlResponse, PermissionScope};

pub const OPTION_ALLOW_ONCE: &str = "allow-once";
pub const OPTION_ALLOW_ALWAYS: &str = "allow-always";
pub const OPTION_REJECT_ONCE: &str = "reject-once";

/// The offered option list for `request`: the adapter's own (Codex) when it
/// supplies one, Claude's derivation otherwise (plan task 7, D4). The client
/// must not infer a permission's effect from an option's `kind`/`name`
/// (spec: "the daemon/adapter owns the effect") — an id outside this list
/// falls through to [`GateAnswerError::UnknownOption`].
fn offered_options(request: &ControlRequest) -> Vec<PermissionOption> {
    request
        .options
        .clone()
        .unwrap_or_else(|| claude_default_options(request))
}

/// Claude offers allow-once and reject-once always, plus allow-always only
/// when the CLI sent rule suggestions to save it against (D4; matches
/// `origin/main`'s `PermissionGate.tsx` — "Always allow" only when
/// `request.suggestions.length > 0`) — there is nothing to make "always"
/// durable otherwise.
fn claude_default_options(request: &ControlRequest) -> Vec<PermissionOption> {
    let mut options = vec![PermissionOption {
        option_id: OPTION_ALLOW_ONCE.into(),
        name: "Allow once".into(),
        kind: PermissionOptionKind::AllowOnce,
        meta: None,
    }];
    if !request.suggestions.is_empty() {
        options.push(PermissionOption {
            option_id: OPTION_ALLOW_ALWAYS.into(),
            name: "Always allow".into(),
            kind: PermissionOptionKind::AllowAlways,
            meta: None,
        });
    }
    options.push(PermissionOption {
        option_id: OPTION_REJECT_ONCE.into(),
        name: "Reject".into(),
        kind: PermissionOptionKind::RejectOnce,
        meta: None,
    });
    options
}

/// An `allow`-family kind grants; a `reject`-family kind denies — the only
/// two effects a plain `{optionId}` answer can carry (spec: gate resolution
/// is binary at the wire, richer intents ride `_mainframe.dev`).
fn behavior_for(kind: PermissionOptionKind) -> ControlBehavior {
    match kind {
        PermissionOptionKind::AllowOnce | PermissionOptionKind::AllowAlways => {
            ControlBehavior::Allow
        }
        PermissionOptionKind::RejectOnce | PermissionOptionKind::RejectAlways => {
            ControlBehavior::Deny
        }
    }
}

/// `PermissionOption.meta["_mainframe.dev"].updatedInput` (plan decision 2):
/// how an adapter-supplied option (a Codex question choice) carries its own
/// answer payload without the client inferring anything from the option id.
fn updated_input_from_option(
    option: &PermissionOption,
) -> Option<HashMap<String, serde_json::Value>> {
    let namespace = option.meta.as_ref()?.get(MAINFRAME_META_NAMESPACE)?;
    let updated = namespace.get("updatedInput")?;
    serde_json::from_value(updated.clone()).ok()
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
        options: offered_options(request),
        // The full `ControlRequest` (input, suggestions, decision reason) —
        // what the rich gate cards render and what `rich_answer` below
        // validates a rich reply against. Generic ACP clients ignore it and
        // render the option list (desktop-cutover pass).
        meta: Some(serde_json::json!({
            MAINFRAME_META_NAMESPACE: { "controlRequest": request }
        })),
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
/// `ControlResponse`. The `optionId` always resolves against
/// [`offered_options`] first, then overlays the selected option's
/// `scope`/`updatedInput` onto a rich `_mainframe.dev` answer — the client
/// never sets `scope` itself, so without the overlay a session-scoped
/// allow (e.g. Codex's `acceptForSession`) would re-prompt next turn
/// (R3.2/T19).
pub fn parse_answer(
    request: &ControlRequest,
    response: RequestPermissionResponse,
) -> Result<ControlResponse, GateAnswerError> {
    let RequestPermissionOutcome::Selected { option_id } = &response.outcome else {
        return Err(GateAnswerError::Cancelled);
    };

    let options = offered_options(request);
    // The option is resolved before the rich branch: the `_mainframe.dev`
    // payload overlays a plain answer, it does not replace the check that the
    // daemon offered this option at all.
    let selected = options
        .iter()
        .find(|option| &option.option_id == option_id)
        .ok_or_else(|| GateAnswerError::UnknownOption(option_id.clone()))?;

    if let Some(mut rich) = rich_answer(request, &response) {
        if matches!(selected.kind, PermissionOptionKind::AllowAlways) {
            rich.scope = rich.scope.or(Some(PermissionScope::Session));
        }
        rich.updated_input = rich
            .updated_input
            .or_else(|| updated_input_from_option(selected));
        return Ok(rich);
    }

    let scope = matches!(selected.kind, PermissionOptionKind::AllowAlways)
        .then_some(PermissionScope::Session);

    Ok(ControlResponse {
        request_id: request.request_id.clone(),
        tool_use_id: request.tool_use_id.clone(),
        tool_name: Some(request.tool_name.clone()),
        behavior: behavior_for(selected.kind),
        updated_input: updated_input_from_option(selected),
        updated_permissions: None,
        message: None,
        execution_mode: None,
        clear_context: None,
        scope,
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
