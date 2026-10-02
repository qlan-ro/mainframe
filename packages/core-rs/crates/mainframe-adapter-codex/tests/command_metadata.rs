#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;
use common::Recorder;
use mainframe_adapter_codex::event_mapper::{CodexSessionState, handle_notification};
use mainframe_adapter_codex::history::convert_thread_items;
use mainframe_adapter_codex::item_types::ThreadItem;
use serde_json::{Value, json};
use std::collections::HashMap;

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

#[test]
fn command_metadata_live_and_history_keep_exact_values_and_bash_contract() {
    let raw = command();
    let rec = Recorder::new();
    emit(
        &rec,
        &mut CodexSessionState::default(),
        "item/completed",
        raw.clone(),
    );
    let live = block(&rec);
    assert_eq!(
        live["commandExecution"],
        json!({"commandActions":raw["commandActions"],"reportedDurationMs":1234})
    );
    assert_eq!(live["name"], "Bash");
    assert_eq!(live["input"], json!({"command":"cat a"}));
    assert_eq!(rec.message_vendor_ids(), vec![Some("cmd".into())]);
    let item: ThreadItem = serde_json::from_value(raw).unwrap();
    let history = convert_thread_items(&[item], "chat", &HashMap::new(), &HashMap::new());
    assert_eq!(live, serde_json::to_value(&history[0].content[0]).unwrap());
    let result = serde_json::to_value(&rec.tool_results()[0][0]).unwrap();
    assert_eq!(result["content"], "hello\n");
    assert_eq!(result["isError"], true);
}

#[test]
fn command_metadata_sparse_completion_retains_start_actions_without_started_row() {
    let rec = Recorder::new();
    let mut state = CodexSessionState::default();
    let mut started = command();
    started["aggregatedOutput"] = Value::Null;
    started["durationMs"] = Value::Null;
    emit(&rec, &mut state, "item/started", started.clone());
    assert!(rec.messages().is_empty());
    let mut completed = command();
    completed.as_object_mut().unwrap().remove("commandActions");
    completed["durationMs"] = json!(0);
    emit(&rec, &mut state, "item/completed", completed.clone());
    assert_eq!(
        block(&rec)["commandExecution"],
        json!({"commandActions":started["commandActions"], "reportedDurationMs":0})
    );
    emit(&rec, &mut state, "item/completed", completed);
    assert_eq!(
        block(&rec)["commandExecution"],
        json!({"reportedDurationMs":0})
    );
}

#[test]
fn command_metadata_null_missing_empty_and_future_actions_are_tolerant() {
    for actions in [
        Value::Null,
        json!([]),
        json!([{"type":"future","command":"run"}, 7, {"type":"read","command":"broken"}]),
    ] {
        let mut raw = command();
        raw["commandActions"] = actions.clone();
        raw["durationMs"] = Value::Null;
        raw["aggregatedOutput"] = Value::Null;
        let rec = Recorder::new();
        emit(
            &rec,
            &mut CodexSessionState::default(),
            "item/completed",
            raw,
        );
        let expected = match actions {
            Value::Null => Value::Null,
            Value::Array(ref a) if a.is_empty() => json!({"commandActions":[]}),
            _ => {
                json!({"commandActions":[{"type":"unknown","command":"run"},{"type":"unknown","command":""},{"type":"unknown","command":"broken"}]})
            }
        };
        assert_eq!(block(&rec)["commandExecution"], expected);
        assert_eq!(
            serde_json::to_value(&rec.tool_results()[0][0]).unwrap()["content"],
            ""
        );
    }
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

#[test]
fn command_metadata_reused_identity_replaces_start_and_empty_completion_overrides() {
    let rec = Recorder::new();
    let mut state = CodexSessionState::default();
    emit(&rec, &mut state, "item/started", command());
    emit(&rec, &mut state, "item/started", sparse());
    emit(&rec, &mut state, "item/completed", sparse());
    assert_eq!(
        block(&rec)["commandExecution"],
        json!({"reportedDurationMs":1234})
    );
    emit(&rec, &mut state, "item/started", command());
    let mut empty = sparse();
    empty["commandActions"] = json!([]);
    emit(&rec, &mut state, "item/completed", empty);
    assert_eq!(block(&rec)["commandExecution"]["commandActions"], json!([]));
}

#[test]
fn command_metadata_unregistered_threads_cannot_seed_parent_state() {
    let rec = Recorder::new();
    let mut state = CodexSessionState {
        thread_id: Some("t".into()),
        ..Default::default()
    };
    routed(
        &rec,
        &mut state,
        "item/started",
        "stranger",
        "turn",
        command(),
    );
    emit(&rec, &mut state, "item/completed", sparse());
    assert_eq!(
        block(&rec)["commandExecution"],
        json!({"reportedDurationMs":1234})
    );
}

#[test]
fn command_metadata_child_interruption_discards_abandoned_actions() {
    let rec = Recorder::new();
    let (_registry, deps) = common::temp_registry(&[]);
    let mut state = CodexSessionState {
        thread_id: Some("t".into()),
        registry_deps: Some(deps),
        ..Default::default()
    };
    emit(
        &rec,
        &mut state,
        "item/completed",
        json!({"type":"subAgentActivity","id":"task","kind":"started","agentThreadId":"child"}),
    );
    turn(&rec, &mut state, "turn/started", "child", "one");
    routed(&rec, &mut state, "item/started", "child", "one", command());
    emit(
        &rec,
        &mut state,
        "item/completed",
        json!({"type":"subAgentActivity","id":"stop","kind":"interrupted","agentThreadId":"child"}),
    );
    routed(&rec, &mut state, "item/started", "child", "one", command());
    routed(&rec, &mut state, "item/completed", "child", "one", sparse());
    assert!(
        block(&rec)["commandExecution"]
            .get("commandActions")
            .is_none()
    );
    turn(&rec, &mut state, "turn/started", "child", "two");
    routed(&rec, &mut state, "item/completed", "child", "two", sparse());
    assert!(
        block(&rec)["commandExecution"]
            .get("commandActions")
            .is_none()
    );
}

#[test]
fn command_metadata_missing_notification_turn_id_keeps_start_actions() {
    let rec = Recorder::new();
    let mut state = CodexSessionState::default();
    emit(&rec, &mut state, "item/started", command());
    handle_notification(
        "item/completed",
        &json!({"threadId":"t", "item":sparse()}),
        &rec.sink(),
        &mut state,
    );
    assert_eq!(
        block(&rec)["commandExecution"]["commandActions"],
        command()["commandActions"]
    );
}
