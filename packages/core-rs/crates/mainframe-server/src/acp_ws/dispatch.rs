//! Inbound frame routing for one facade connection (todo #350, live-wiring
//! pass). Classifies each WS text frame once (`rpc::parse_frame`) and peels
//! off the two stateful flows — `session/resume` (reply + replay + stream
//! seed, ordered atomically through the hub) and gate-answer responses —
//! before falling through to the pure `mainframe_acp::dispatch_with_prompt`
//! dispatcher for `initialize`, `session/prompt`, `session/cancel`, and the
//! unknown-method/malformed-frame errors.

use std::sync::Arc;

use mainframe_acp::prompt::PromptPort;
use mainframe_acp::rpc::{self, InboundFrame};
use mainframe_acp::{DaemonInfo, dispatch_with_prompt};
use mainframe_types::acp::extensions::SessionDetachParams;
use mainframe_types::acp::jsonrpc::JsonRpcResponse;
use tracing::error;

use crate::ctx::AppCtx;

use super::facade_conn::FacadeConnection;
use super::ports::ManagerPorts;

mod gate_answers;
mod resume;
use gate_answers::handle_gate_answer;
use resume::start_resume;

/// Handle one inbound text frame. `Some` is a reply the socket loop writes
/// directly, covering every arm except `session/resume` (pushes its own
/// reply through the connection channel so the replay updates cannot
/// overtake it) and the two session methods that run off the loop —
/// `session/prompt` and `session/cancel` (T10, and the ordering below: a
/// prompt's reply goes through the connection channel and may trail frames
/// its own request caused; `sendPrompt` on the client only reads
/// `_meta.position` from it, and run state comes from the reducer, not reply
/// ordering).
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
            handle_gate_answer(response, &ctx.facade_hub, &ports, connection).await;
            None
        }
        InboundFrame::Request(request) if request.method == "session/resume" => {
            if !connection.is_negotiated() {
                return Some(wire(&rpc::error_response(
                    request.id,
                    mainframe_acp::initialize_required(),
                )));
            }
            start_resume(request, ctx, connection, Arc::new(ports));
            None
        }
        InboundFrame::Notification(note) if note.method == "_mainframe.dev/session_detach" => {
            handle_session_detach(note.params, connection);
            None
        }
        InboundFrame::Request(request) if request.method == "session/prompt" => {
            let session_id = params_session_id(request.params.as_ref());
            handle_session_method(
                InboundFrame::Request(request),
                session_id,
                daemon,
                Arc::new(ports),
                ctx,
                connection,
            );
            None
        }
        InboundFrame::Notification(note) if note.method == "session/cancel" => {
            let session_id = params_session_id(note.params.as_ref());
            handle_session_method(
                InboundFrame::Notification(note),
                session_id,
                daemon,
                Arc::new(ports),
                ctx,
                connection,
            );
            None
        }
        frame => dispatch_fallback(frame, daemon, &ports, connection).await,
    }
}

/// `session/prompt` and `session/cancel`: attach-on-send stays inline, ahead
/// of the spawn — T35 pins this ordering (a connection observes the session
/// from the moment it sends, not from whenever the spawned task gets
/// scheduled) — but behind the negotiation gate, so a peer whose call is
/// about to be refused never gets a stream (spec decision 32).
fn handle_session_method(
    frame: InboundFrame,
    session_id: Option<String>,
    daemon: &DaemonInfo,
    ports: Arc<dyn PromptPort>,
    ctx: &Arc<AppCtx>,
    connection: &Arc<FacadeConnection>,
) {
    if connection.is_negotiated()
        && let Some(session_id) = &session_id
    {
        ctx.facade_hub.attach(connection, session_id);
    }
    spawn_session_method(
        frame,
        session_id,
        daemon.clone(),
        ports,
        Arc::clone(connection),
    );
}

/// What is left once `session/resume`, a gate answer, `session_detach`, and
/// the two spawned session methods are peeled off: `initialize` and the
/// malformed/unknown-method errors. None of them touch a session, so all of
/// them stay inline; a successful `initialize` marks the connection
/// negotiated.
async fn dispatch_fallback(
    frame: InboundFrame,
    daemon: &DaemonInfo,
    ports: &ManagerPorts,
    connection: &Arc<FacadeConnection>,
) -> Option<String> {
    let outcome = dispatch_with_prompt(frame, daemon, ports, connection.is_negotiated()).await;
    if outcome.negotiated {
        connection.mark_negotiated();
    }
    outcome.reply
}

/// The session methods run off the socket-loop task (R3.6, plan decision 5):
/// a cold-chat start's adapter spawn can take seconds, and inlining it would
/// stall every other frame on this connection — heartbeats, a call for a
/// different chat, another chat's `session/update`.
///
/// Both take the SAME per-session lock, so calls for one session run in
/// arrival order: concurrent prompts serialize because queue position
/// depends on enqueue order, and a cancel cannot overtake the prompt it
/// means to stop — inline, it reached `interrupt_chat` while the cold start
/// was still inside `spawn()`, interrupting a turn that had not begun.
fn spawn_session_method(
    frame: InboundFrame,
    session_id: Option<String>,
    daemon: DaemonInfo,
    ports: Arc<dyn PromptPort>,
    connection: Arc<FacadeConnection>,
) {
    let negotiated = connection.is_negotiated();
    // Queued here, on the socket loop, so arrival order is acquisition order.
    let wait = session_id
        .as_deref()
        .map(|id| connection.enqueue_prompt_lock(id));
    let request_id = match &frame {
        InboundFrame::Request(request) => request.id.clone(),
        _ => None,
    };
    tokio::spawn(async move {
        let _guard = match wait {
            Some(wait) => Some(wait.guard().await),
            None => None,
        };
        let task_conn = Arc::clone(&connection);
        // Its own task, so a panic in the dispatch cannot leave a
        // `session/prompt` unanswered: its promise has no other end, and a
        // connection-level heartbeat never reveals one missing reply.
        let work = tokio::spawn(async move {
            let outcome = dispatch_with_prompt(frame, &daemon, ports.as_ref(), negotiated).await;
            if let Some(reply) = outcome.reply {
                task_conn.send_raw(reply);
            }
        });
        if let Err(err) = work.await {
            error!(
                %err,
                session_id = session_id.as_deref().unwrap_or("<none>"),
                answered = request_id.is_some(),
                "acp facade: session method failed"
            );
            // A notification (`session/cancel`) has no id to answer under;
            // the log is all it gets.
            if let Some(id) = request_id {
                connection.send_json(&rpc::error_response(
                    Some(id),
                    rpc::internal_error("session method failed"),
                ));
            }
        }
    });
}

/// The `sessionId` every session method carries in its params.
pub(super) fn params_session_id(params: Option<&serde_json::Value>) -> Option<String> {
    params?
        .get("sessionId")
        .and_then(|value| value.as_str())
        .map(str::to_string)
}

/// `_mainframe.dev/session_detach` (D2): drop this connection's stream state
/// and pending gates for the session, the same teardown `ChatEnded` already
/// does — a malformed or missing `sessionId` is silently ignored, matching
/// every other extension notification's tolerance for a stale client.
fn handle_session_detach(params: Option<serde_json::Value>, connection: &Arc<FacadeConnection>) {
    let Some(params) = params.and_then(|p| serde_json::from_value::<SessionDetachParams>(p).ok())
    else {
        return;
    };
    connection.forget_chat(&params.session_id);
}

pub(super) fn wire(response: &JsonRpcResponse) -> String {
    serde_json::to_string(response).unwrap_or_else(|_| {
        r#"{"jsonrpc":"2.0","id":null,"error":{"code":-32603,"message":"internal error"}}"#.into()
    })
}

#[cfg(test)]
mod tests;
