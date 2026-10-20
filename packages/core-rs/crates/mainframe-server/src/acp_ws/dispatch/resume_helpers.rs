use crate::acp_ws::facade_conn::rpc_id_string;
use crate::ctx::AppCtx;
use std::sync::Arc;

/// The queued-prompt snapshot every resume replay closes with — empty when
/// the harness runs without a `ChatManager`.
pub(super) fn queued_for(
    ctx: &Arc<AppCtx>,
    session_id: &str,
) -> Vec<mainframe_types::chat::QueuedMessageRef> {
    ctx.chat.chat_manager.get_queued_for_chat(session_id)
}

/// The rpc id of the gate this replay redelivers itself, which the hub's
/// buffered-frame drain must not raise a second time.
pub(super) fn redelivered_gate_id(replay: &mainframe_acp::ResumeReplay) -> Option<String> {
    replay
        .pending_gate
        .as_ref()
        .map(|gate| rpc_id_string(&gate.request_id))
}

use super::super::super::facade_conn::FacadeConnection;
use mainframe_acp::rpc;
use mainframe_types::acp::jsonrpc::RequestId;
use tracing::error;

/// One `session/resume` delivery that never returned, as its failure path
/// needs it.
pub(super) struct ResumeFailure<'a> {
    pub(super) connection: &'a FacadeConnection,
    pub(super) request_id: Option<RequestId>,
    pub(super) session_id: Option<&'a str>,
    /// Whether the success reply already went out — `reset_session` sets it
    /// as it sends, in whichever arm sends it.
    pub(super) replied: bool,
    /// Whether `replay_complete` already went out — `reset_session` sets it
    /// as it sends, in whichever arm sends it.
    pub(super) completed: bool,
    pub(super) cause: String,
}

/// Answer for a resume whose delivery never returned. The resync sends the
/// client back for a fresh one, which nothing else would: heartbeats are
/// connection-level, so its watchdog sees no gap, and a first attach has not
/// attached yet, so its own gap resume returns early.
///
/// A claim whose reply never went out also owes the client one — its promise
/// is still pending, and it has no other end. Once that reply is on the wire,
/// a second response for that id could only be dropped, and the seeded stream
/// it left behind is the one the client is reading.
pub(super) fn fail_resume(failure: ResumeFailure<'_>) {
    let ResumeFailure {
        connection,
        request_id,
        session_id,
        replied,
        completed,
        cause,
    } = failure;
    if !replied {
        connection.send_json(&rpc::error_response(
            request_id,
            rpc::internal_error("resume failed"),
        ));
    }
    let Some(session_id) = session_id else {
        error!(%cause, "resume delivery failed with no session to recover");
        return;
    };
    // The reply reached the client, but the panic struck before
    // `reset_session`'s own `replay_complete` send — this delivery still
    // owes the client the closing marker for the reply it already has, with
    // `aborted: true` so a staged client discards whatever partial replay it
    // received.
    if replied && !completed {
        connection.send_json(&mainframe_acp::replay_complete_notification(
            session_id, true,
        ));
    }
    let failures = connection.record_resume_failure(session_id);
    error!(
        %cause,
        session_id,
        failures,
        resync_suppressed = failures > 1,
        "resume delivery failed"
    );
    // The client answers a resync with another resume, so a failure that
    // repeats on the same transcript would loop at round-trip speed. After
    // the first, recovery is left to its gap/reconnect path.
    //
    // Sent directly rather than through the hub's per-session throttle: an
    // unseeded slot has no stream to queue against, and the buffer it does
    // hold is about to be dropped.
    if failures == 1 {
        connection.send_json(&mainframe_acp::resync_notification(session_id));
    }
    if !replied {
        connection.forget_chat(session_id);
    }
}
