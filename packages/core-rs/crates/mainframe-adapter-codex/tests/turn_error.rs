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
use serde_json::json;

fn fail_turn(message: &str) -> Option<String> {
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
            "turn": { "id": "turn-1", "status": "failed", "items": [], "error": { "message": message } },
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
        fail_turn("stream disconnected before completion").as_deref(),
        Some("stream disconnected before completion")
    );
}
