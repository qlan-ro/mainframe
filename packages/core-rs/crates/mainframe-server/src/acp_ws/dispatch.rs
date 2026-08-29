//! Inbound frame routing for one facade connection (todo #350, live-wiring
//! pass). Classifies each WS text frame once (`rpc::parse_frame`) and peels
//! off the two stateful flows — `session/resume` (reply + replay + stream
//! seed, ordered atomically through the hub) and gate-answer responses —
//! before falling through to the pure `mainframe_acp::dispatch_with_prompt`
//! dispatcher for `initialize`, `session/prompt`, `session/cancel`, and the
//! unknown-method/malformed-frame errors.

use std::sync::Arc;

use mainframe_acp::rpc::{self, InboundFrame};
use mainframe_acp::{
    AnswerOutcome, DaemonInfo, GateAnswerError, dispatch_resume, dispatch_with_prompt,
    parse_permission_answer,
};
use mainframe_types::acp::jsonrpc::{JsonRpcOutcome, JsonRpcRequest, JsonRpcResponse, RequestId};
use mainframe_types::acp::permission::RequestPermissionResponse;
use tracing::{debug, warn};

use crate::ctx::AppCtx;

use super::facade_conn::{FacadeConnection, PendingGate};
use super::ports::ManagerPorts;

/// Handle one inbound text frame. `Some` is a reply the socket loop writes
/// directly (safe: the loop writes it before draining the outbound channel
/// again); the resume path pushes its reply through the connection channel
/// itself so the replay updates cannot overtake it, and returns `None`.
pub async fn handle_inbound(
    text: &str,
    daemon: &DaemonInfo,
    ctx: &Arc<AppCtx>,
    connection: &Arc<FacadeConnection>,
) -> Option<String> {
    let frame = match rpc::parse_frame(text) {
        Ok(frame) => frame,
        Err(error) => {
            return Some(wire(&rpc::error_response(None, error)));
        }
    };
    let ports = ManagerPorts::new(ctx.chat_manager.clone());
    match frame {
        InboundFrame::Response(response) => {
            handle_gate_answer(response, ctx, connection).await;
            None
        }
        InboundFrame::Request(request) if request.method == "session/resume" => {
            handle_resume(request, ctx, connection, &ports).await;
            None
        }
        frame => {
            if let Some(session_id) = prompt_session_id(&frame) {
                ctx.facade_hub.attach(connection, &session_id);
            }
            dispatch_with_prompt(frame, daemon, &ports).await
        }
    }
}

/// Attach-on-prompt: a connection that prompts a session observes it from
/// then on. Attaching before dispatch (even if the prompt later fails) is
/// harmless — a session that never runs emits nothing.
fn prompt_session_id(frame: &InboundFrame) -> Option<String> {
    let params = match frame {
        InboundFrame::Request(request) if request.method == "session/prompt" => {
            request.params.as_ref()?
        }
        InboundFrame::Notification(note) if note.method == "session/cancel" => {
            note.params.as_ref()?
        }
        _ => return None,
    };
    params
        .get("sessionId")
        .and_then(|value| value.as_str())
        .map(str::to_string)
}

/// `session/resume`: compute the snapshot, then — atomically with respect to
/// live fan-out for this session — seed the stream state and push the reply,
/// the replay updates, and any redelivered open gate through the connection
/// channel in that order.
async fn handle_resume(
    request: JsonRpcRequest,
    ctx: &Arc<AppCtx>,
    connection: &Arc<FacadeConnection>,
    ports: &ManagerPorts,
) {
    let session_id = request
        .params
        .as_ref()
        .and_then(|params| params.get("sessionId"))
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let (response, replay) = dispatch_resume(request, ports).await;

    let Some(session_id) = session_id else {
        // Malformed params: dispatch_resume already produced the structured
        // error; there is no session to seed.
        connection.send_json(&response);
        return;
    };

    let queued = ctx
        .chat_manager
        .as_ref()
        .map(|cm| cm.get_queued_for_chat(&session_id))
        .unwrap_or_default();
    ctx.facade_hub
        .reset_session(connection, &session_id, &replay.items, |conn| {
            conn.send_json(&response);
            for update in replay.updates {
                conn.send_update(&session_id, update);
            }
            if let (Some(frame), Some(control)) =
                (&replay.pending_permission_request, &replay.pending_gate)
            {
                conn.deliver_gate(&session_id, control, frame);
            }
            // Queue snapshot LAST, and even when empty: resume is the
            // reconnecting client's only stale-queued-turn eviction.
            conn.send_json(&mainframe_acp::queue_state_notification(
                &session_id,
                queued,
            ));
        });
}

/// A client's answer to a daemon-initiated `session/request_permission`.
async fn handle_gate_answer(
    response: JsonRpcResponse,
    ctx: &Arc<AppCtx>,
    connection: &Arc<FacadeConnection>,
) {
    let Some(RequestId::Str(rpc_id)) = response.id.clone() else {
        debug!("acp facade: response with no recognizable id dropped");
        return;
    };
    let Some(pending) = connection.peek_gate(&rpc_id) else {
        debug!(rpc_id, "acp facade: response matches no pending gate");
        return;
    };
    let answer = match response.outcome {
        JsonRpcOutcome::Result { result } => {
            match serde_json::from_value::<RequestPermissionResponse>(result) {
                Ok(answer) => answer,
                Err(err) => {
                    // Keep the gate pending: a malformed answer must not
                    // destroy the client's only chance to answer it.
                    warn!(rpc_id, %err, "acp facade: malformed permission answer");
                    return;
                }
            }
        }
        JsonRpcOutcome::Error { error } => {
            warn!(
                rpc_id,
                code = error.code,
                "acp facade: client answered a gate with an error"
            );
            connection.remove_gate(&rpc_id);
            return;
        }
    };
    apply_gate_answer(&rpc_id, pending, answer, ctx, connection).await;
}

async fn apply_gate_answer(
    rpc_id: &str,
    pending: PendingGate,
    answer: RequestPermissionResponse,
    ctx: &Arc<AppCtx>,
    connection: &Arc<FacadeConnection>,
) {
    let request_id = pending.request.request_id.clone();
    let control = match parse_permission_answer(&pending.request, answer) {
        Ok(control) => control,
        Err(GateAnswerError::Cancelled) => {
            // The client's cancelled outcome accompanies its own
            // `session/cancel`, which owns gate cancellation via
            // `interrupt_chat` — nothing to apply here.
            connection.remove_gate(rpc_id);
            return;
        }
        Err(GateAnswerError::UnknownOption(option)) => {
            // Never treated as approval (spec); the gate stays pending so a
            // corrected answer can still land.
            warn!(rpc_id, option, "acp facade: unknown permission option");
            return;
        }
    };
    connection.remove_gate(rpc_id);
    match ctx.facade_hub.claim_gate(&pending.chat_id, &request_id) {
        AnswerOutcome::AlreadyResolved => {
            debug!(rpc_id, "acp facade: late answer to a resolved gate");
        }
        AnswerOutcome::Apply => {
            let Some(manager) = ctx.chat_manager.clone() else {
                ctx.facade_hub.release_gate(&pending.chat_id, &request_id);
                warn!(rpc_id, "acp facade: no chat manager to apply a gate answer");
                return;
            };
            if let Err(err) = manager
                .respond_to_permission(&pending.chat_id, control)
                .await
            {
                // Release the claim so a retried answer is not wedged behind
                // AlreadyResolved.
                ctx.facade_hub.release_gate(&pending.chat_id, &request_id);
                warn!(rpc_id, %err, "acp facade: respond_to_permission failed");
            }
        }
    }
}

pub(super) fn wire(response: &JsonRpcResponse) -> String {
    serde_json::to_string(response).unwrap_or_else(|_| {
        r#"{"jsonrpc":"2.0","id":null,"error":{"code":-32603,"message":"internal error"}}"#.into()
    })
}
