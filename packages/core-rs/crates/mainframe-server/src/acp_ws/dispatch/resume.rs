use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use mainframe_acp::resume::ResumePort;
use mainframe_acp::revision_log::RevisionLog;
use mainframe_acp::{ResumeOptions, dispatch_resume_with, rpc};
use mainframe_types::acp::extensions::RevisionCursor;
use mainframe_types::acp::jsonrpc::{JsonRpcRequest, RequestId};

use crate::ctx::AppCtx;

use super::super::facade_conn::{FacadeConnection, SessionLockWait};
use super::super::hub::ResumeSeed;
use super::params_session_id;
#[path = "resume_helpers.rs"]
mod helpers;
use helpers::{ResumeFailure, fail_resume, queued_for, redelivered_gate_id};

pub(super) fn start_resume(
    request: JsonRpcRequest,
    ctx: &Arc<AppCtx>,
    connection: &Arc<FacadeConnection>,
    ports: Arc<dyn ResumePort>,
) {
    if connection.is_windowed_history_opted_in()
        && let Err(err) = mainframe_acp::history_window::parse_window(
            request
                .params
                .as_ref()
                .and_then(|params| params.get("_meta")),
        )
    {
        connection.send_json(&rpc::error_response(
            request.id,
            rpc::invalid_params(&err.to_string()),
        ));
        return;
    }
    let session_id = params_session_id(request.params.as_ref());
    let (revision_log, resume_boundary) = session_id
        .as_deref()
        .and_then(|id| ctx.chat.facade_hub.begin_resume(connection, id))
        .map_or((None, None), |(log, boundary)| (Some(log), Some(boundary)));
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
        revision_log,
        resume_boundary,
    };
    tokio::spawn(task.run(wait));
}

struct DeliveryProgress {
    /// Set the moment the reply goes out, so the failure path below knows
    /// whether the client's promise has settled without asking the session
    /// map — which a concurrent detach or `ChatEnded` can empty.
    replied: Arc<AtomicBool>,
    /// Set the moment `replay_complete` goes out (`reset_session`, both
    /// arms) — `fail_resume` reads this alongside `replied` to know whether
    /// IT still owes the client the closing marker.
    completed: Arc<AtomicBool>,
}

struct ResumeTask {
    request: JsonRpcRequest,
    request_id: Option<RequestId>,
    session_id: Option<String>,
    ctx: Arc<AppCtx>,
    connection: Arc<FacadeConnection>,
    ports: Arc<dyn ResumePort>,
    /// The chat's revision log, from `begin_resume` — `None`
    /// for a connection that did not opt into revision cursors.
    revision_log: Option<Arc<Mutex<RevisionLog>>>,
    /// `begin_resume`'s pre-snapshot boundary for `revision_log` — carried
    /// into the reply's `cursor` untouched.
    resume_boundary: Option<RevisionCursor>,
}

impl ResumeTask {
    fn reclaim_window(&mut self) {
        if !self.connection.is_windowed_history_opted_in()
            || !self
                .session_id
                .as_deref()
                .is_some_and(|id| self.connection.is_attached(id))
        {
            return;
        }
        let current = self
            .session_id
            .as_deref()
            .and_then(|id| self.ctx.chat.facade_hub.begin_resume(&self.connection, id));
        (self.revision_log, self.resume_boundary) =
            current.map_or((None, None), |(log, boundary)| (Some(log), Some(boundary)));
    }

    async fn run(mut self, wait: Option<SessionLockWait>) {
        let _guard = match wait {
            Some(wait) => Some(wait.guard().await),
            None => None,
        };
        self.reclaim_window();
        let ResumeTask {
            request,
            request_id,
            session_id,
            ctx,
            connection,
            ports,
            revision_log,
            resume_boundary,
        } = self;
        let claimed = session_id.clone();
        let (task_ctx, task_conn) = (Arc::clone(&ctx), Arc::clone(&connection));
        let replied = Arc::new(AtomicBool::new(false));
        let completed = Arc::new(AtomicBool::new(false));
        let task_progress = DeliveryProgress {
            replied: Arc::clone(&replied),
            completed: Arc::clone(&completed),
        };
        // `reset_session` is the only exit from `AwaitingSeed`, so a panic on
        // the way to it would leave this session buffering every event for
        // the connection's remaining life, silently. Run it as its own task
        // so `fail_resume` can answer for it.
        let delivery = tokio::spawn(async move {
            // Zipped here, not threaded as two parameters, so the reply
            // cursor can never drift from the log it was planned against.
            let revision_log = revision_log.as_deref().zip(resume_boundary);
            deliver_resume(
                request,
                session_id,
                &task_ctx,
                &task_conn,
                ports.as_ref(),
                revision_log,
                task_progress,
            )
            .await;
        });
        if let Err(err) = delivery.await {
            fail_resume(ResumeFailure {
                connection: &connection,
                request_id,
                session_id: claimed.as_deref(),
                replied: replied.load(Ordering::Relaxed),
                completed: completed.load(Ordering::Relaxed),
                cause: err.to_string(),
            });
        }
    }
}

async fn deliver_resume(
    request: JsonRpcRequest,
    session_id: Option<String>,
    ctx: &Arc<AppCtx>,
    connection: &Arc<FacadeConnection>,
    ports: &dyn ResumePort,
    // The log paired with `begin_resume`'s pre-snapshot boundary:
    // one tuple, so the reply cursor cannot drift from the planned-against log.
    revision_log: Option<(&Mutex<RevisionLog>, RevisionCursor)>,
    progress: DeliveryProgress,
) {
    let options = ResumeOptions {
        result_previews: connection.is_replay_result_previews_opted_in(),
        windowed_history: connection.is_windowed_history_opted_in(),
    };
    let (response, replay) = dispatch_resume_with(request, ports, revision_log, options).await;

    let Some(session_id) = session_id else {
        // Malformed params: dispatch_resume already produced the structured
        // error; there is no session to seed, so no `replay_complete` either
        // — nothing was ever replied `true` for a session.
        connection.send_json(&response);
        progress.replied.store(true, Ordering::Relaxed);
        return;
    };

    let queued = queued_for(ctx, &session_id);
    let redelivered_gate = redelivered_gate_id(&replay);
    let seed = ResumeSeed {
        containers: &replay.containers,
        reply: &response,
        replied: progress.replied,
        completed: progress.completed,
        redelivered_gate: redelivered_gate.as_deref(),
        preview_ids: &replay.preview_ids,
    };
    let hub = &ctx.chat.facade_hub;
    hub.reset_session(connection, &session_id, seed, |conn| {
        // An opted-in connection takes the replay as a few
        // compressed batches; every other arm below is unchanged either way.
        if conn.is_compressed_replay_opted_in() {
            for note in mainframe_acp::replay_batch_notifications(&session_id, &replay.updates) {
                conn.send_json(&note);
            }
        } else {
            for update in replay.updates {
                conn.send_update(&session_id, update);
            }
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
    connection.clear_resume_failures(&session_id);
}

#[cfg(test)]
#[path = "resume_tests.rs"]
mod tests;
