//! A windowed first resume that defers seeding the revision log answers exactly
//! as one that seeds it, leaves the log for its caller, and keeps every cursor
//! the log later hands out correct.
use super::*;
use mainframe_types::acp::jsonrpc::JsonRpcOutcome;

fn port(count: usize) -> FakePort {
    FakePort {
        messages: (0..count)
            .map(|i| dmsg(&format!("m{i}"), vec![text(&format!("message {i}"))]))
            .collect(),
        ..Default::default()
    }
}

fn meta(response: &JsonRpcResponse) -> Value {
    match &response.outcome {
        JsonRpcOutcome::Result { result } => result["_meta"][MAINFRAME_META_NAMESPACE].clone(),
        other => panic!("unexpected response: {other:?}"),
    }
}

async fn resume(
    port: &FakePort,
    cursor: Value,
    log: &Mutex<RevisionLog>,
    defer: bool,
) -> (JsonRpcResponse, ResumeReplay) {
    let mut request = resume_request(Some(cursor));
    // A reconnect names the floor its window already holds.
    if let Some(floor) = floor(&request) {
        request.params.as_mut().unwrap()["_meta"] =
            json!({ MAINFRAME_META_NAMESPACE: { "window": { "floorItemId": floor } } });
    }
    let boundary = log.lock().unwrap().boundary();
    dispatch_resume_with(
        request,
        port,
        Some((log, boundary)),
        ResumeOptions {
            result_previews: true,
            windowed_history: true,
            defer_log_seed: defer,
        },
    )
    .await
}

const FLOOR: &str = "message:0:top:m80";

fn floor(request: &JsonRpcRequest) -> Option<&'static str> {
    (request.params.as_ref()?["replayFrom"]["type"] == "revision").then_some(FLOOR)
}

fn new_log() -> Mutex<RevisionLog> {
    Mutex::new(RevisionLog::new("epoch".into()))
}

fn seeded(log: &Mutex<RevisionLog>) -> bool {
    log.lock().unwrap().is_seeded()
}

fn revision(cursor: &Value) -> Value {
    json!({"type":"revision","epoch":cursor["epoch"],"revision":cursor["revision"]})
}

fn change(port: &mut FakePort, log: &Mutex<RevisionLog>, index: usize, body: &str) {
    port.messages[index].content = vec![text(body)];
    log.lock().unwrap().record_delta(
        &crate::EncodedDelta::full(encoder::encode_containers(&port.messages, None)),
        Vec::new,
    );
}

#[tokio::test]
async fn a_first_window_answers_the_same_and_leaves_the_log_unseeded() {
    let port = port(120);
    let (eager_log, deferred_log) = (new_log(), new_log());
    let (eager, eager_replay) = resume(&port, json!({"type":"start"}), &eager_log, false).await;
    let (deferred, replay) = resume(&port, json!({"type":"start"}), &deferred_log, true).await;
    assert!(seeded(&eager_log));
    assert!(!seeded(&deferred_log));
    assert_eq!(meta(&deferred), meta(&eager));
    assert_eq!(replay.items, eager_replay.items);
    assert_eq!(replay.containers, eager_replay.containers);
    assert_eq!(replay.updates.len(), eager_replay.updates.len());
    assert!(eager_replay.seed_copy.is_none());
    let copy = replay
        .seed_copy
        .expect("the reply's own transcript, copied in its read");
    assert_eq!(copy.messages.len(), 120);
}

#[tokio::test]
async fn a_revision_cursor_resume_seeds_eagerly_even_when_deferring() {
    let port = port(120);
    let log = new_log();
    let (reply, _) = resume(&port, json!({"type":"start"}), &log, true).await;
    let cursor = revision(&meta(&reply)["cursor"]);
    assert!(!seeded(&log));
    let (_, _) = resume(&port, cursor, &log, true).await;
    assert!(
        seeded(&log),
        "its plan reads the log, so the log is seeded first"
    );
}

#[tokio::test]
async fn an_item_cursor_resume_is_not_windowed_and_seeds_as_before() {
    let port = port(120);
    let log = new_log();
    resume(
        &port,
        json!({"type":"item","itemId":"message:0:top:m5"}),
        &log,
        true,
    )
    .await;
    assert!(seeded(&log));
}

#[tokio::test]
async fn a_change_that_lands_before_the_seed_is_never_lost_to_a_reconnect() {
    let mut port = port(120);
    let log = new_log();
    let (reply, _) = resume(&port, json!({"type":"start"}), &log, true).await;
    let cursor = revision(&meta(&reply)["cursor"]);
    // A live revision arrives while the log is still unseeded: it records in full, which seeds.
    change(&mut port, &log, 100, "edited while seeding");
    assert!(seeded(&log));
    let (reply, replay) = resume(&port, cursor, &log, true).await;
    assert!(
        replay
            .items
            .iter()
            .any(|item| format!("{item:?}").contains("edited while seeding")),
        "the reconnect carries the edit: {:?}",
        meta(&reply)
    );
}

#[tokio::test]
async fn a_seed_that_comes_after_the_reply_serves_a_later_reconnect_incrementally() {
    let mut port = port(120);
    let log = new_log();
    let (reply, _) = resume(&port, json!({"type":"start"}), &log, true).await;
    let cursor = revision(&meta(&reply)["cursor"]);
    // The caller's deferred seed, from the same transcript the reply read.
    log.lock()
        .unwrap()
        .seed_containers(&encoder::encode_containers(&port.messages, None));
    change(&mut port, &log, 100, "edited after seeding");
    let (reply, replay) = resume(&port, cursor, &log, true).await;
    assert_ne!(
        meta(&reply)["fullReplay"],
        true,
        "served from the log, not by replaying"
    );
    assert!(
        replay
            .items
            .iter()
            .any(|item| format!("{item:?}").contains("edited after seeding"))
    );
}
