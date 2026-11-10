//! Codex's `error` notification: a `willRetry: true` one is the only live
//! signal that the response stream dropped and Codex is reconnecting. It
//! reaches the sink as `on_api_retry`; the terminal `willRetry: false` one is
//! left to the `turn/completed` that follows.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "Test assertions and scenarios"
)]

mod common;

use common::{Recorder, temp_registry};
use mainframe_adapter_codex::event_mapper::{CodexSessionState, handle_notification};
use serde_json::{Value, json};

fn state() -> CodexSessionState {
    CodexSessionState {
        thread_id: Some("t1".to_string()),
        current_turn_id: Some("turn-1".to_string()),
        ..Default::default()
    }
}

fn error_params(thread: &str, will_retry: bool, message: &str) -> Value {
    json!({
        "threadId": thread,
        "turnId": "turn-1",
        "willRetry": will_retry,
        "error": {
            "message": message,
            "codexErrorInfo": { "responseStreamDisconnected": { "httpStatusCode": null } },
        },
    })
}

fn deliver(params: &Value, state: &mut CodexSessionState) -> Recorder {
    let rec = Recorder::new();
    handle_notification("error", params, &rec.sink(), state);
    rec
}

#[test]
fn a_reconnect_with_a_count_reports_the_attempt_and_keeps_the_maximum_in_the_reason() {
    let rec = deliver(
        &error_params("t1", true, "Reconnecting... 2/5"),
        &mut state(),
    );
    let retries = rec.retries();
    assert_eq!(retries.len(), 1);
    assert_eq!(retries[0].0, 2);
    assert!(retries[0].1.as_deref().unwrap().contains("2/5"));
}

#[test]
fn additional_details_join_the_reason() {
    let mut params = error_params("t1", true, "Reconnecting... 3/5");
    params["error"]["additionalDetails"] = json!("tls handshake eof");
    let retries = deliver(&params, &mut state()).retries();
    let reason = retries[0].1.clone().unwrap();
    assert!(reason.starts_with("Reconnecting... 3/5"), "{reason}");
    assert!(reason.contains("tls handshake eof"), "{reason}");
}

#[test]
fn a_non_string_additional_details_never_drops_the_retry() {
    let mut params = error_params("t1", true, "Reconnecting... 1/5");
    params["error"]["additionalDetails"] = json!({ "unexpected": true });
    assert_eq!(deliver(&params, &mut state()).retries().len(), 1);
}

#[test]
fn a_countless_reconnect_reports_an_unknown_attempt() {
    let rec = deliver(
        &error_params("t1", true, "Reconnecting... waiting for network"),
        &mut state(),
    );
    let retries = rec.retries();
    assert_eq!(retries.len(), 1);
    assert_eq!(retries[0].0, 0);
    assert!(
        retries[0]
            .1
            .as_deref()
            .unwrap()
            .contains("waiting for network")
    );
}

#[test]
fn a_terminal_error_notification_reaches_no_sink_method() {
    let rec = deliver(
        &error_params("t1", false, "stream disconnected before completion"),
        &mut state(),
    );
    assert!(rec.retries().is_empty());
    assert!(rec.results().is_empty());
    assert!(rec.errors().is_empty());
}

#[test]
fn a_foreign_thread_is_dropped() {
    let rec = deliver(
        &error_params("elsewhere", true, "Reconnecting... 2/5"),
        &mut state(),
    );
    assert!(rec.retries().is_empty());
}

#[test]
fn a_child_thread_reaches_the_chat_sink_unwrapped() {
    let mut state = state();
    let (_registry_dir, deps) = temp_registry(&[]);
    state.registry_deps = Some(deps);
    let registered = Recorder::new();
    handle_notification(
        "item/completed",
        &json!({
            "threadId": "t1",
            "item": {
                "type": "subAgentActivity",
                "id": "call-1",
                "kind": "started",
                "agentThreadId": "child",
                "agentPath": null,
            },
        }),
        &registered.sink(),
        &mut state,
    );
    let rec = deliver(
        &error_params("child", true, "Reconnecting... 4/5"),
        &mut state,
    );
    assert_eq!(rec.retries().len(), 1);
    assert_eq!(rec.retries()[0].0, 4);
}

#[test]
fn a_malformed_notification_is_ignored_without_failing_anything() {
    let mut state = state();
    for params in [
        json!({ "threadId": "t1", "willRetry": true }),
        json!({ "threadId": "t1", "willRetry": "yes", "error": { "message": "x" } }),
        json!({ "threadId": "t1", "willRetry": true, "error": { "message": 7 } }),
        Value::Null,
    ] {
        let rec = deliver(&params, &mut state);
        assert!(rec.retries().is_empty(), "{params}");
        assert!(rec.errors().is_empty(), "{params}");
    }
}
