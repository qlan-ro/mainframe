//! End-to-end `dispatch_resume` revision-cursor cases, split out of `tests.rs`
//! to keep it under 300 lines — it shares that file's fixtures (`dmsg`, `text`,
//! `FakePort`, `resume_request`) via `use super::*`.

use std::sync::Mutex;

use mainframe_types::acp::jsonrpc::JsonRpcOutcome;

use super::*;

fn revision_cursor_request(epoch: &str, revision: u64) -> JsonRpcRequest {
    resume_request(Some(json!({
        "type": "revision",
        "epoch": epoch,
        "revision": revision,
    })))
}

fn cursor_meta(response: &JsonRpcResponse) -> Value {
    let JsonRpcOutcome::Result { result } = &response.outcome else {
        panic!("expected a success response");
    };
    result["_meta"]["_mainframe.dev"]["cursor"].clone()
}

/// The boundary `hub.rs::begin_resume` would have captured for `log` right
/// before the snapshot await — these cases have no race to simulate (the
/// one that does, `a_resume_never_acknowledges_a_revision_recorded_during_
/// its_own_snapshot_await`, captures it explicitly instead), so the
/// captured boundary and `log`'s current one are the same value here.
fn boundary_of(log: &Mutex<RevisionLog>) -> mainframe_types::acp::extensions::RevisionCursor {
    log.lock().unwrap().boundary()
}

/// A revision cursor with a boundary yields the incremental updates plus
/// `cursor` meta and no `fullReplay`.
#[tokio::test]
async fn a_revision_cursor_yields_incremental_updates_and_cursor_meta() {
    let log = Mutex::new(RevisionLog::new("ep_1".to_string()));
    {
        // Encoded the same way the snapshot will be, so the log's copy
        // matches exactly and `plan` does not also re-create it as
        // "differs from the log" alongside the genuinely new item.
        let seeded = encoder::encode(&[dmsg("dmsg_1", vec![text("first")])]);
        log.lock().unwrap().record(&seeded);
    }
    let port = FakePort {
        messages: vec![
            dmsg("dmsg_1", vec![text("first")]),
            dmsg("dmsg_2", vec![text("second")]),
        ],
        ..FakePort::default()
    };
    let (response, replay) = dispatch_resume(
        revision_cursor_request("ep_1", 1),
        &port,
        Some((&log, boundary_of(&log))),
    )
    .await;

    assert_eq!(cursor_meta(&response)["epoch"], json!("ep_1"));
    let JsonRpcOutcome::Result { result } = &response.outcome else {
        panic!("expected a success response");
    };
    assert!(
        result["_meta"]["_mainframe.dev"]["fullReplay"].is_null(),
        "an in-range revision cursor is not a full replay"
    );
    // One create for the new item, plus the trailing turn state.
    assert_eq!(replay.updates.len(), 2);
    assert!(matches!(
        replay.updates[0],
        SessionUpdate::AgentMessage(ref upsert) if upsert.message_id == "dmsg_2"
    ));
}

/// An unknown epoch yields a full replay with `fullReplay: true` and the
/// new cursor.
#[tokio::test]
async fn an_unknown_epoch_yields_a_full_replay_with_the_new_cursor() {
    let log = Mutex::new(RevisionLog::new("ep_current".to_string()));
    let port = FakePort {
        messages: vec![dmsg("dmsg_1", vec![text("hello")])],
        ..FakePort::default()
    };
    let (response, _replay) = dispatch_resume(
        revision_cursor_request("ep_stale", 5),
        &port,
        Some((&log, boundary_of(&log))),
    )
    .await;

    let JsonRpcOutcome::Result { result } = &response.outcome else {
        panic!("expected a success response");
    };
    assert_eq!(result["_meta"]["_mainframe.dev"]["fullReplay"], json!(true));
    assert_eq!(cursor_meta(&response)["epoch"], json!("ep_current"));
}

/// `start` and `item` cursors against a connection with NO log (never
/// opted in) produce today's exact output: no `cursor` meta at all.
#[tokio::test]
async fn legacy_cursors_without_a_log_carry_no_cursor_meta() {
    let port = FakePort {
        messages: vec![dmsg("dmsg_1", vec![text("hello")])],
        ..FakePort::default()
    };
    let (response, _replay) = dispatch_resume(
        resume_request(Some(json!({ "type": "start" }))),
        &port,
        None,
    )
    .await;

    let JsonRpcOutcome::Result { result } = &response.outcome else {
        panic!("expected a success response");
    };
    assert!(result["_meta"]["_mainframe.dev"]["cursor"].is_null());
}

/// An unseeded log is seeded from the snapshot: the resume still replays
/// every item (the log had nothing recorded yet), and the boundary comes
/// back as revision 0.
#[tokio::test]
async fn an_unseeded_log_is_seeded_from_the_resume_snapshot() {
    let log = Mutex::new(RevisionLog::new("ep_1".to_string()));
    let port = FakePort {
        messages: vec![dmsg("dmsg_1", vec![text("hello")])],
        ..FakePort::default()
    };
    let (response, replay) =
        dispatch_resume(resume_request(None), &port, Some((&log, boundary_of(&log)))).await;

    assert_eq!(
        cursor_meta(&response),
        json!({ "epoch": "ep_1", "revision": 0 })
    );
    assert_eq!(replay.updates.len(), 2, "every item, plus the turn state");
}

/// A `ResumePort` whose `resume_snapshot` future, once polled, records a
/// revision into the SAME log `dispatch_resume` was handed — simulating a
/// display revision landing in the gap between `begin_resume`'s captured
/// boundary and this call's own snapshot read. The messages it hands back
/// to `dispatch_resume` are the ones captured before that in-flight record,
/// mirroring the production shape: the snapshot this resume replays
/// against was already fixed by the time the race lands.
struct RacingPort<'a> {
    messages: Vec<DisplayMessage>,
    log: &'a Mutex<RevisionLog>,
    racing_items: Vec<EncodedItem>,
}

impl ResumePort for RacingPort<'_> {
    fn resume_snapshot<'a>(&'a self, _session_id: &'a str) -> BoxFuture<'a, ResumeSnapshot> {
        let messages = self.messages.clone();
        Box::pin(async move {
            // The race: a display revision lands while this snapshot await
            // is in flight, after `begin_resume` already captured its
            // boundary and installed the `AwaitingSeed` claim that buffers
            // it as catch-up — but before this call's own `plan`/seed runs.
            self.log.lock().unwrap().record(&self.racing_items);
            ResumeSnapshot {
                messages,
                streaming: None,
                pending: None,
            }
        })
    }

    fn is_running(&self, _session_id: &str) -> bool {
        false
    }
}

/// The reply's `cursor` must be the boundary captured BEFORE the snapshot
/// await, never a fresh `log.boundary()` read after it — otherwise it
/// acknowledges a change the snapshot (and therefore this reply) never
/// actually sent, and a later resume with that cursor would skip the
/// change for good.
#[tokio::test]
async fn a_resume_never_acknowledges_a_revision_recorded_during_its_own_snapshot_await() {
    let log = Mutex::new(RevisionLog::new("ep_1".to_string()));
    let seeded = encoder::encode(&[dmsg("dmsg_1", vec![text("first")])]);
    log.lock().unwrap().record(&seeded);
    // `begin_resume` captures the boundary strictly before the snapshot
    // await — this is that capture.
    let captured_boundary = boundary_of(&log);

    let racing_items = encoder::encode(&[
        dmsg("dmsg_1", vec![text("first")]),
        dmsg("dmsg_2", vec![text("second")]),
    ]);
    let port = RacingPort {
        messages: vec![dmsg("dmsg_1", vec![text("first")])],
        log: &log,
        racing_items,
    };

    let (response, _replay) = dispatch_resume(
        resume_request(Some(
            json!({ "type": "revision", "epoch": "ep_1", "revision": 1 }),
        )),
        &port,
        Some((&log, captured_boundary.clone())),
    )
    .await;

    let reply_cursor = cursor_meta(&response);
    assert_eq!(
        reply_cursor,
        json!({ "epoch": captured_boundary.epoch, "revision": captured_boundary.revision }),
        "the reply must carry the pre-snapshot boundary, not the log's post-race one"
    );
    let catch_up_revision = boundary_of(&log).revision;
    assert!(
        reply_cursor["revision"].as_u64().unwrap() < catch_up_revision,
        "the racing revision must be strictly ahead of what the reply acknowledged"
    );
}
