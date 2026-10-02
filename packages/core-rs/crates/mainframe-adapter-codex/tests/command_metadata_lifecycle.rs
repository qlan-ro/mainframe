#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;
use common::Recorder;
use mainframe_adapter_codex::event_mapper::{CodexSessionState, handle_notification};
use serde_json::{Value, json};

// Synthetic commandExecution fixture derived from Codex 0.155.1 generated v2 schema.
fn command() -> Value {
    json!({"type":"commandExecution", "id":"cmd", "command":"cat a", "status":"completed",
        "aggregatedOutput":"hello\n", "exitCode":1,
        "commandActions":[{"type":"read","command":"cat a","name":"a","path":"a"},
            {"type":"search","command":"rg x","query":null,"path":null},
            {"type":"listFiles","command":"ls","path":null}], "durationMs":1234})
}
fn emit(rec: &Recorder, state: &mut CodexSessionState, method: &str, item: Value) {
    handle_notification(
        method,
        &json!({"threadId":"t", "turnId":"turn", "item":item}),
        &rec.sink(),
        state,
    );
}
fn block(rec: &Recorder) -> Value {
    serde_json::to_value(&rec.messages().last().unwrap()[0]).unwrap()
}

fn routed(
    rec: &Recorder,
    state: &mut CodexSessionState,
    method: &str,
    thread: &str,
    turn: &str,
    item: Value,
) {
    handle_notification(
        method,
        &json!({"threadId":thread, "turnId":turn, "item":item}),
        &rec.sink(),
        state,
    );
}
fn turn(rec: &Recorder, state: &mut CodexSessionState, method: &str, thread: &str, id: &str) {
    handle_notification(
        method,
        &json!({"threadId":thread,"turn":{"id":id,"status":"completed"}}),
        &rec.sink(),
        state,
    );
}
fn sparse() -> Value {
    let mut raw = command();
    raw.as_object_mut().unwrap().remove("commandActions");
    raw
}

fn child_state(rec: &Recorder) -> (tempfile::TempDir, CodexSessionState) {
    let (registry, deps) = common::temp_registry(&[]);
    let mut state = CodexSessionState {
        thread_id: Some("t".into()),
        registry_deps: Some(deps),
        ..Default::default()
    };
    emit(
        rec,
        &mut state,
        "item/completed",
        json!({"type":"subAgentActivity","id":"task","kind":"started","agentThreadId":"child"}),
    );
    turn(rec, &mut state, "turn/started", "t", "one");
    turn(rec, &mut state, "turn/started", "child", "child-one");
    (registry, state)
}

#[test]
fn command_metadata_interleaved_child_does_not_consume_parent_actions() {
    let rec = Recorder::new();
    let (_registry, mut state) = child_state(&rec);
    routed(&rec, &mut state, "item/started", "t", "one", command());
    let mut child = command();
    child["commandActions"] = json!([]);
    routed(
        &rec,
        &mut state,
        "item/started",
        "child",
        "child-one",
        child,
    );
    routed(
        &rec,
        &mut state,
        "item/completed",
        "child",
        "child-one",
        sparse(),
    );
    assert_eq!(block(&rec)["commandExecution"]["commandActions"], json!([]));
    assert_eq!(block(&rec)["parentToolUseId"], "task");
    routed(&rec, &mut state, "item/completed", "t", "one", sparse());
    assert_eq!(
        block(&rec)["commandExecution"]["commandActions"],
        command()["commandActions"]
    );
}

#[test]
fn command_metadata_child_and_parent_turn_completion_clear_abandoned_starts() {
    let rec = Recorder::new();
    let (_registry, mut state) = child_state(&rec);
    routed(
        &rec,
        &mut state,
        "item/started",
        "child",
        "child-one",
        command(),
    );
    turn(&rec, &mut state, "turn/completed", "child", "child-one");
    routed(
        &rec,
        &mut state,
        "item/completed",
        "child",
        "child-one",
        sparse(),
    );
    assert!(
        block(&rec)["commandExecution"]
            .get("commandActions")
            .is_none()
    );
    turn(&rec, &mut state, "turn/started", "child", "child-two");
    routed(
        &rec,
        &mut state,
        "item/started",
        "child",
        "child-two",
        command(),
    );
    routed(&rec, &mut state, "item/started", "t", "one", command());
    turn(&rec, &mut state, "turn/completed", "t", "one");
    for (thread, turn) in [("t", "one"), ("child", "child-two")] {
        routed(&rec, &mut state, "item/started", thread, turn, command());
        routed(&rec, &mut state, "item/completed", thread, turn, sparse());
        assert!(
            block(&rec)["commandExecution"]
                .get("commandActions")
                .is_none()
        );
    }
}

#[test]
fn command_metadata_late_turn_completion_cannot_clear_new_turn_start() {
    let rec = Recorder::new();
    let mut state = CodexSessionState {
        thread_id: Some("t".into()),
        ..Default::default()
    };
    turn(&rec, &mut state, "turn/started", "t", "old");
    turn(&rec, &mut state, "turn/started", "t", "new");
    routed(&rec, &mut state, "item/started", "t", "new", command());
    turn(&rec, &mut state, "turn/completed", "t", "old");
    routed(&rec, &mut state, "item/completed", "t", "new", sparse());
    assert_eq!(
        block(&rec)["commandExecution"]["commandActions"],
        command()["commandActions"]
    );
}
