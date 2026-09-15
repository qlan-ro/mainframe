//! `session/resume`: the one method whose cost is unbounded — a cold chat's
//! snapshot loads the whole transcript off disk — so it runs off the
//! socket-loop task (todo #350, PR #688 review). Only the `AwaitingSeed`
//! claim stays inline, because live frames racing the snapshot must be
//! buffered from the moment the client asked, not from whenever the spawned
//! task gets scheduled.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use mainframe_acp::resume::ResumePort;
use mainframe_acp::{dispatch_resume, rpc};
use mainframe_types::acp::jsonrpc::{JsonRpcRequest, RequestId};
use tracing::error;

use crate::ctx::AppCtx;

use super::super::facade_conn::{FacadeConnection, SessionLockWait, rpc_id_string};
use super::super::hub::ResumeSeed;
use super::params_session_id;

/// Claim the session's slot inline, then run the snapshot behind the same
/// per-session lock `session/prompt` and `session/cancel` take — a resume
/// that overtook an in-flight prompt would replay a snapshot from the middle
/// of that send.
pub(super) fn start_resume(
    request: JsonRpcRequest,
    ctx: &Arc<AppCtx>,
    connection: &Arc<FacadeConnection>,
    ports: Arc<dyn ResumePort>,
) {
    let session_id = params_session_id(request.params.as_ref());
    // Mark this session as awaiting its snapshot BEFORE anything awaits, so
    // a live revision that races it is buffered rather than lost (T5, R2.9).
    if let Some(session_id) = &session_id {
        ctx.facade_hub.begin_resume(connection, session_id);
    }
    // Queued here, on the socket loop, so arrival order is acquisition order.
    let wait = session_id
        .as_deref()
        .map(|id| connection.enqueue_prompt_lock(id));
    let task = ResumeTask {
        request_id: request.id.clone(),
        request,
        session_id,
        ctx: Arc::clone(ctx),
        connection: Arc::clone(connection),
        ports,
    };
    tokio::spawn(task.run(wait));
}

/// One `session/resume` past the socket loop: everything the spawned task
/// needs to deliver the snapshot, and to answer for it if the delivery never
/// returns.
struct ResumeTask {
    request: JsonRpcRequest,
    request_id: Option<RequestId>,
    session_id: Option<String>,
    ctx: Arc<AppCtx>,
    connection: Arc<FacadeConnection>,
    ports: Arc<dyn ResumePort>,
}

impl ResumeTask {
    async fn run(self, wait: Option<SessionLockWait>) {
        let _guard = match wait {
            Some(wait) => Some(wait.guard().await),
            None => None,
        };
        let ResumeTask {
            request,
            request_id,
            session_id,
            ctx,
            connection,
            ports,
        } = self;
        let claimed = session_id.clone();
        let (task_ctx, task_conn) = (Arc::clone(&ctx), Arc::clone(&connection));
        // Set the moment the reply goes out, so the failure path below knows
        // whether the client's promise has settled without asking the session
        // map — which a concurrent detach or `ChatEnded` can empty.
        let replied = Arc::new(AtomicBool::new(false));
        let task_replied = Arc::clone(&replied);
        // `reset_session` is the only exit from `AwaitingSeed`, so a panic on
        // the way to it would leave this session buffering every event for
        // the connection's remaining life, silently. Run it as its own task
        // so `fail_resume` can answer for it.
        let delivery = tokio::spawn(async move {
            deliver_resume(
                request,
                session_id,
                &task_ctx,
                &task_conn,
                ports.as_ref(),
                &task_replied,
            )
            .await;
        });
        if let Err(err) = delivery.await {
            fail_resume(ResumeFailure {
                connection: &connection,
                request_id,
                session_id: claimed.as_deref(),
                replied: replied.load(Ordering::Relaxed),
                cause: err.to_string(),
            });
        }
    }
}

/// One `session/resume` delivery that never returned, as its failure path
/// needs it.
struct ResumeFailure<'a> {
    connection: &'a FacadeConnection,
    request_id: Option<RequestId>,
    session_id: Option<&'a str>,
    /// Whether the success reply already went out — `reset_session` returned.
    replied: bool,
    cause: String,
}

/// Answer for a resume whose delivery never returned. The resync sends the
/// client back for a fresh one, which nothing else would: heartbeats are
/// connection-level, so its watchdog sees no gap, and a first attach has not
/// attached yet, so its own gap resume returns early.
///
/// A claim whose reply never went out also owes the client one — its promise
/// is still pending, and it has no other end. Once `reset_session` has
/// returned, the reply is on the wire (it goes out in both of that method's
/// arms), so a second response for that id could only be dropped.
fn fail_resume(failure: ResumeFailure<'_>) {
    let ResumeFailure {
        connection,
        request_id,
        session_id,
        replied,
        cause,
    } = failure;
    if !replied {
        connection.send_json(&rpc::error_response(
            request_id,
            rpc::internal_error("resume failed"),
        ));
    }
    let Some(session_id) = session_id else {
        error!(%cause, "acp facade: resume delivery failed with no session to recover");
        return;
    };
    let failures = connection.record_resume_failure(session_id);
    error!(
        %cause,
        session_id,
        failures,
        resync_suppressed = failures > 1,
        "acp facade: resume delivery failed"
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

/// Compute the snapshot, then — atomically with respect to live fan-out for
/// this session — seed the stream state and push the reply, the replay
/// updates, and any redelivered open gate through the connection channel in
/// that order.
async fn deliver_resume(
    request: JsonRpcRequest,
    session_id: Option<String>,
    ctx: &Arc<AppCtx>,
    connection: &Arc<FacadeConnection>,
    ports: &dyn ResumePort,
    replied: &AtomicBool,
) {
    let (response, replay) = dispatch_resume(request, ports).await;

    let Some(session_id) = session_id else {
        // Malformed params: dispatch_resume already produced the structured
        // error; there is no session to seed.
        connection.send_json(&response);
        replied.store(true, Ordering::Relaxed);
        return;
    };

    let queued = queued_for(ctx, &session_id);
    let redelivered_gate = redelivered_gate_id(&replay);
    let seed = ResumeSeed {
        items: &replay.items,
        reply: &response,
        redelivered_gate: redelivered_gate.as_deref(),
    };
    let hub = &ctx.facade_hub;
    hub.reset_session(connection, &session_id, seed, |conn| {
        for update in replay.updates {
            conn.send_update(&session_id, update);
        }
        if let (Some(frame), Some(control)) =
            (&replay.pending_permission_request, &replay.pending_gate)
        {
            hub.redeliver_gate(conn, &session_id, control, frame);
        }
        // Queue snapshot LAST, and even when empty: resume is the
        // reconnecting client's only stale-queued-turn eviction.
        conn.send_json(&mainframe_acp::queue_state_notification(
            &session_id,
            queued,
        ));
    });
    replied.store(true, Ordering::Relaxed);
    connection.clear_resume_failures(&session_id);
}

/// The queued-prompt snapshot every resume replay closes with — empty when
/// the harness runs without a `ChatManager`.
fn queued_for(ctx: &Arc<AppCtx>, session_id: &str) -> Vec<mainframe_types::chat::QueuedMessageRef> {
    ctx.chat_manager
        .as_ref()
        .map(|cm| cm.get_queued_for_chat(session_id))
        .unwrap_or_default()
}

/// The rpc id of the gate this replay redelivers itself, which the hub's
/// buffered-frame drain must not raise a second time.
fn redelivered_gate_id(replay: &mainframe_acp::ResumeReplay) -> Option<String> {
    replay
        .pending_gate
        .as_ref()
        .map(|gate| rpc_id_string(&gate.request_id))
}

#[cfg(test)]
mod tests;
