//! Inbound frame routing for one facade connection (todo #350, live-wiring
//! pass). Classifies each WS text frame once (`rpc::parse_frame`) and peels
//! off the two stateful flows — `session/resume` (reply + replay + stream
//! seed, ordered atomically through the hub) and gate-answer responses —
//! before falling through to the pure `mainframe_acp::dispatch_with_prompt`
//! dispatcher for `initialize`, `session/prompt`, `session/cancel`, and the
//! unknown-method/malformed-frame errors.

use std::sync::Arc;

use mainframe_acp::rpc::{self, InboundFrame};
use mainframe_acp::{DaemonInfo, dispatch_resume, dispatch_with_prompt};
use mainframe_types::acp::extensions::SessionDetachParams;
use mainframe_types::acp::jsonrpc::{JsonRpcRequest, JsonRpcResponse};

use crate::ctx::AppCtx;

use super::facade_conn::FacadeConnection;
use super::ports::ManagerPorts;

mod gate_answers;
use gate_answers::handle_gate_answer;

/// Handle one inbound text frame. `Some` is a reply the socket loop writes
/// directly, covering every arm except `session/resume` (pushes its own
/// reply through the connection channel so the replay updates cannot
/// overtake it) and `session/prompt` (T10: spawned, so its reply goes
/// through the connection channel too and may trail frames its own request
/// caused — `sendPrompt` on the client only reads `_meta.position` from it,
/// and run state comes from the reducer, not reply ordering).
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
            handle_resume(request, ctx, connection, &ports).await;
            None
        }
        InboundFrame::Notification(note) if note.method == "_mainframe.dev/session_detach" => {
            handle_session_detach(note.params, connection);
            None
        }
        InboundFrame::Request(request) if request.method == "session/prompt" => {
            // Attach-on-send stays inline, ahead of the spawn: T35 pins this
            // ordering (a connection observes the session from the moment it
            // sends, not from whenever the spawned task gets scheduled) —
            // but behind the negotiation gate, so a peer whose prompt is
            // about to be refused never gets a stream (spec decision 32).
            if connection.is_negotiated()
                && let Some(session_id) = prompt_session_id(&InboundFrame::Request(request.clone()))
            {
                ctx.facade_hub.attach(connection, &session_id);
            }
            spawn_prompt(request, daemon.clone(), ports, Arc::clone(connection));
            None
        }
        frame => dispatch_fallback(frame, daemon, &ports, ctx, connection).await,
    }
}

/// Everything besides `session/resume`, a gate answer, `session_detach`, and
/// `session/prompt` — `initialize`, `session/cancel`, and the malformed/
/// unknown-method errors. Attaches on a `session/cancel` the same as a
/// prompt (todo #350: a client observes a session it cancels), and marks
/// the connection negotiated on a successful `initialize` reply.
async fn dispatch_fallback(
    frame: InboundFrame,
    daemon: &DaemonInfo,
    ports: &ManagerPorts,
    ctx: &Arc<AppCtx>,
    connection: &Arc<FacadeConnection>,
) -> Option<String> {
    if connection.is_negotiated()
        && let Some(session_id) = prompt_session_id(&frame)
    {
        ctx.facade_hub.attach(connection, &session_id);
    }
    let is_initialize = matches!(&frame, InboundFrame::Request(r) if r.method == "initialize");
    let reply = dispatch_with_prompt(frame, daemon, ports, connection.is_negotiated()).await;
    if is_initialize && reply_is_ok(reply.as_deref()) {
        connection.mark_negotiated();
    }
    reply
}

fn reply_is_ok(reply: Option<&str>) -> bool {
    reply
        .and_then(|r| serde_json::from_str::<serde_json::Value>(r).ok())
        .is_some_and(|v| v.get("result").is_some())
}

/// `session/prompt` alone runs off the socket-loop task (R3.6, plan decision
/// 5): a cold-chat start's adapter spawn can take seconds, and inlining it
/// would stall every other frame on this connection — heartbeats, a cancel
/// for a different chat, another chat's `session/update`. Concurrent prompts
/// for the SAME session still serialize (`session_prompt_lock`), since queue
/// position depends on enqueue order.
fn spawn_prompt(
    request: JsonRpcRequest,
    daemon: DaemonInfo,
    ports: ManagerPorts,
    connection: Arc<FacadeConnection>,
) {
    let session_id = request
        .params
        .as_ref()
        .and_then(|p| p.get("sessionId"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let negotiated = connection.is_negotiated();
    tokio::spawn(async move {
        let lock = session_id
            .as_deref()
            .map(|id| connection.session_prompt_lock(id));
        let _guard = match &lock {
            Some(lock) => Some(lock.lock().await),
            None => None,
        };
        let frame = InboundFrame::Request(request);
        if let Some(reply) = dispatch_with_prompt(frame, &daemon, &ports, negotiated).await {
            connection.send_raw(reply);
        }
    });
}

/// Attach-on-prompt: a negotiated connection that prompts a session observes
/// it from then on. Attaching before dispatch (even if the prompt later
/// fails) is harmless — a session that never runs emits nothing.
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
    // Mark this session as awaiting its snapshot BEFORE the await, so a live
    // revision that races it is buffered rather than lost (T5, R2.9).
    if let Some(session_id) = &session_id {
        ctx.facade_hub.begin_resume(connection, session_id);
    }
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

pub(super) fn wire(response: &JsonRpcResponse) -> String {
    serde_json::to_string(response).unwrap_or_else(|_| {
        r#"{"jsonrpc":"2.0","id":null,"error":{"code":-32603,"message":"internal error"}}"#.into()
    })
}
