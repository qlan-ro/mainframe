//! A failed parent turn carries readable error text to the chat, not the
//! Responses API's raw JSON envelope.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "Test assertions and scenarios"
)]

mod common;

use common::Recorder;
use mainframe_adapter_codex::event_mapper::{CodexSessionState, handle_notification};
use serde_json::{Value, json};

const STREAM_HEADLINE: &str = "OpenAI kept dropping the response and Codex gave up retrying. If this keeps happening in this chat, start a new chat or switch provider.";
const GENERIC_HEADLINE: &str = "Codex hit an error and could not finish this turn. If this keeps happening in this chat, start a new chat or switch provider.";
const CAPACITY: &str = "Selected model is at capacity. Please try a different model.";
const STREAM_TEXT: &str =
    "stream disconnected before completion: stream closed before response.completed";

fn fail_turn(message: &str) -> Option<String> {
    fail_turn_with(json!({ "message": message }))
}

fn with_info(message: &str, info: Value) -> Option<String> {
    fail_turn_with(json!({ "message": message, "codexErrorInfo": info }))
}

fn fail_turn_with(error: Value) -> Option<String> {
    let rec = Recorder::new();
    let mut state = CodexSessionState {
        thread_id: Some("t1".to_string()),
        current_turn_id: Some("turn-1".to_string()),
        ..Default::default()
    };
    handle_notification(
        "turn/completed",
        &json!({
            "threadId": "t1",
            "turn": { "id": "turn-1", "status": "failed", "items": [], "error": error },
        }),
        &rec.sink(),
        &mut state,
    );
    let results = rec.results();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].is_error, Some(true));
    results[0].result.clone()
}

#[test]
fn api_envelope_becomes_a_readable_error() {
    let raw = r#"{"type":"error","status":429,"error":{"type":"rate_limit_error","message":"Slow down."}}"#;
    assert_eq!(
        fail_turn(raw).as_deref(),
        Some("OpenAI is rate-limiting Codex. Wait a moment, then retry.\n\nOpenAI: Slow down.")
    );
}

#[test]
fn plain_text_error_is_unchanged() {
    assert_eq!(
        fail_turn("disk quota exceeded").as_deref(),
        Some("disk quota exceeded")
    );
}

#[test]
fn too_many_failed_attempts_gets_the_stream_headline_over_the_original_text() {
    let info = json!({ "responseTooManyFailedAttempts": { "httpStatusCode": null } });
    assert_eq!(
        with_info(STREAM_TEXT, info).as_deref(),
        Some(format!("{STREAM_HEADLINE}\n\n{STREAM_TEXT}").as_str())
    );
}

#[test]
fn stream_text_with_no_metadata_gets_the_stream_headline() {
    assert_eq!(
        fail_turn(STREAM_TEXT).as_deref(),
        Some(format!("{STREAM_HEADLINE}\n\n{STREAM_TEXT}").as_str())
    );
}

#[test]
fn server_overloaded_keeps_the_capacity_sentence_and_headlines_other_text() {
    assert_eq!(
        with_info(CAPACITY, json!("serverOverloaded")).as_deref(),
        Some(CAPACITY)
    );
    assert_eq!(
        with_info("busy", json!("serverOverloaded")).as_deref(),
        Some(format!("{CAPACITY}\n\nbusy").as_str())
    );
}

#[test]
fn other_gets_the_stream_headline_for_stream_text_and_the_generic_one_otherwise() {
    assert_eq!(
        with_info(STREAM_TEXT, json!("other")).as_deref(),
        Some(format!("{STREAM_HEADLINE}\n\n{STREAM_TEXT}").as_str())
    );
    assert_eq!(
        with_info("hook failed", json!("other")).as_deref(),
        Some(format!("{GENERIC_HEADLINE}\n\nhook failed").as_str())
    );
}

#[test]
fn unreadable_metadata_still_completes_the_turn_with_the_raw_text() {
    for info in [
        Value::Null,
        json!("someFutureVariant"),
        json!({ "someFutureVariant": { "x": 1 } }),
        json!({ "a": 1, "b": 2 }),
        json!(17),
    ] {
        assert_eq!(
            with_info("odd failure", info.clone()).as_deref(),
            Some("odd failure"),
            "{info}"
        );
    }
}

#[test]
fn an_envelope_ignores_the_metadata() {
    let raw = r#"{"type":"error","status":429,"error":{"type":"rate_limit_error","message":"Slow down."}}"#;
    let plain = fail_turn(raw);
    for info in [
        json!("other"),
        json!({ "responseTooManyFailedAttempts": {} }),
        json!("serverOverloaded"),
    ] {
        assert_eq!(with_info(raw, info), plain);
    }
}

#[test]
fn a_non_string_additional_details_never_fails_the_turn() {
    let error =
        json!({ "message": "odd failure", "additionalDetails": { "x": 1 }, "misalignment": 3 });
    assert_eq!(fail_turn_with(error).as_deref(), Some("odd failure"));
}
