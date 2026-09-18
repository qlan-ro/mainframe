//! A client's answer to a daemon-initiated `session/request_permission`
//! (todo #350, live-wiring pass) — split out of `dispatch.rs` to keep it
//! under the 300-line cap (T10). `handle_gate_answer` is `dispatch.rs`'s
//! only call in; everything else here is this module's own plumbing.

use mainframe_acp::{AnswerOutcome, GateAnswerError, parse_permission_answer};
use mainframe_types::acp::jsonrpc::{JsonRpcOutcome, JsonRpcResponse, RequestId};
use mainframe_types::acp::permission::RequestPermissionResponse;
use mainframe_types::adapter::{ControlBehavior, ControlRequest, ControlResponse};
use tracing::{debug, warn};

use super::super::facade_conn::{FacadeConnection, PendingGate};
use super::super::hub::FacadeHub;
use super::super::ports::GatePort;

pub(super) async fn handle_gate_answer(
    response: JsonRpcResponse,
    hub: &FacadeHub,
    ports: &dyn GatePort,
    connection: &std::sync::Arc<FacadeConnection>,
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
            // A client that cannot parse the gate says so; treat it as a
            // deny instead of leaving the turn hanging until the CLI dies
            // (R3.7).
            warn!(
                rpc_id,
                code = error.code,
                "acp facade: client answered a gate with an error, denying it"
            );
            let control = deny_response(&pending.request);
            apply_control_response(&rpc_id, pending, control, hub, ports, connection).await;
            return;
        }
    };
    apply_gate_answer(&rpc_id, pending, answer, hub, ports, connection).await;
}

fn deny_response(request: &ControlRequest) -> ControlResponse {
    ControlResponse {
        request_id: request.request_id.clone(),
        tool_use_id: request.tool_use_id.clone(),
        tool_name: Some(request.tool_name.clone()),
        behavior: ControlBehavior::Deny,
        updated_input: None,
        updated_permissions: None,
        message: None,
        execution_mode: None,
        clear_context: None,
        scope: None,
    }
}

async fn apply_gate_answer(
    rpc_id: &str,
    pending: PendingGate,
    answer: RequestPermissionResponse,
    hub: &FacadeHub,
    ports: &dyn GatePort,
    connection: &std::sync::Arc<FacadeConnection>,
) {
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
    apply_control_response(rpc_id, pending, control, hub, ports, connection).await;
}

/// The claim-apply tail shared by a parsed client answer and a synthesized
/// deny (T4): remove the connection's own pending entry, claim the gate on
/// the hub, and forward to the port — restoring both on a transport failure
/// (T3).
async fn apply_control_response(
    rpc_id: &str,
    pending: PendingGate,
    control: ControlResponse,
    hub: &FacadeHub,
    ports: &dyn GatePort,
    connection: &std::sync::Arc<FacadeConnection>,
) {
    let request_id = pending.request.request_id.clone();
    connection.remove_gate(rpc_id);
    match hub.claim_gate(&pending.chat_id, &request_id) {
        AnswerOutcome::AlreadyResolved => {
            debug!(rpc_id, "acp facade: late answer to a resolved gate");
        }
        AnswerOutcome::Apply => {
            if let Err(err) = ports.respond_to_permission(&pending.chat_id, control).await {
                // Release the claim so a retried answer is not wedged behind
                // AlreadyResolved, and restore the connection's own pending
                // entry so the SAME rpc_id is answerable again — a transport
                // failure must not strand the CLI waiting on a gate the
                // client believes it already answered (R2.5).
                hub.release_gate(&pending.chat_id, &request_id);
                connection.restore_gate(rpc_id, pending);
                warn!(rpc_id, %err, "acp facade: respond_to_permission failed");
            }
        }
    }
}

#[cfg(test)]
mod tests;
