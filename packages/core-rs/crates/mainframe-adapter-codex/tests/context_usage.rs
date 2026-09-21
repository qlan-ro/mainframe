//! todo #352 — the Codex adapter must publish `ContextUsage` through the same
//! sink contract Claude uses. Drives `thread/tokenUsage/updated` through
//! `handle_notification`, mirroring `tests/quota_notification.rs`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use common::Recorder;
use mainframe_adapter_codex::event_mapper::{CodexSessionState, handle_notification};
use serde_json::json;

fn state() -> CodexSessionState {
    CodexSessionState {
        thread_id: Some("t1".to_string()),
        ..Default::default()
    }
}

#[test]
fn parent_thread_notification_with_a_reported_window_emits_one_context_usage() {
    let rec = Recorder::new();
    let mut state = state();

    handle_notification(
        "thread/tokenUsage/updated",
        &json!({
            "threadId": "t1",
            "tokenUsage": {
                "last": { "inputTokens": 1_000, "outputTokens": 50 },
                "total": { "inputTokens": 5_000, "outputTokens": 200 },
                "modelContextWindow": 10_000,
            },
        }),
        &rec.sink(),
        &mut state,
    );

    let usages = rec.context_usages();
    assert_eq!(usages.len(), 1);
    assert_eq!(usages[0].total_tokens, 1_000);
    assert_eq!(usages[0].max_tokens, 10_000);
    assert_eq!(usages[0].percentage, 1_000_f64 / 10_000_f64 * 100.0);
}

#[test]
fn sub_thread_notification_emits_no_context_usage() {
    let rec = Recorder::new();
    let mut state = state();

    handle_notification(
        "thread/tokenUsage/updated",
        &json!({
            "threadId": "child_thread_1",
            "tokenUsage": {
                "last": { "inputTokens": 1_000, "outputTokens": 50 },
                "modelContextWindow": 10_000,
            },
        }),
        &rec.sink(),
        &mut state,
    );

    assert_eq!(rec.context_usages().len(), 0);
}

#[test]
fn legacy_top_level_usage_wins_over_the_envelope_for_the_reported_occupancy() {
    let rec = Recorder::new();
    let mut state = state();

    handle_notification(
        "thread/tokenUsage/updated",
        &json!({
            "threadId": "t1",
            "usage": { "input_tokens": 42, "output_tokens": 7 },
            "tokenUsage": {
                "last": { "inputTokens": 1_000, "outputTokens": 50 },
                "modelContextWindow": 10_000,
            },
        }),
        &rec.sink(),
        &mut state,
    );

    let usages = rec.context_usages();
    assert_eq!(usages.len(), 1);
    assert_eq!(usages[0].total_tokens, 42);
    assert_eq!(usages[0].max_tokens, 10_000);
}

#[test]
fn token_usage_last_wins_over_total_when_there_is_no_legacy_usage() {
    let rec = Recorder::new();
    let mut state = state();

    handle_notification(
        "thread/tokenUsage/updated",
        &json!({
            "threadId": "t1",
            "tokenUsage": {
                "last": { "inputTokens": 1_000, "outputTokens": 50 },
                "total": { "inputTokens": 5_000, "outputTokens": 200 },
                "modelContextWindow": 10_000,
            },
        }),
        &rec.sink(),
        &mut state,
    );

    assert_eq!(rec.context_usages()[0].total_tokens, 1_000);
}

#[test]
fn token_usage_total_is_used_when_last_is_absent() {
    let rec = Recorder::new();
    let mut state = state();

    handle_notification(
        "thread/tokenUsage/updated",
        &json!({
            "threadId": "t1",
            "tokenUsage": {
                "total": { "inputTokens": 5_000, "outputTokens": 200 },
                "modelContextWindow": 10_000,
            },
        }),
        &rec.sink(),
        &mut state,
    );

    assert_eq!(rec.context_usages()[0].total_tokens, 5_000);
}

#[test]
fn no_wire_window_falls_back_to_the_resolved_models_table_entry() {
    let rec = Recorder::new();
    let mut state = CodexSessionState {
        thread_id: Some("t1".to_string()),
        resolved_turn_model: Some("gpt-5.5".to_string()),
        ..Default::default()
    };

    handle_notification(
        "thread/tokenUsage/updated",
        &json!({
            "threadId": "t1",
            "tokenUsage": {
                "last": { "inputTokens": 1_000, "outputTokens": 50 },
            },
        }),
        &rec.sink(),
        &mut state,
    );

    let usages = rec.context_usages();
    assert_eq!(usages.len(), 1);
    assert_eq!(usages[0].max_tokens, 272_000);
}

#[test]
fn no_wire_window_and_an_unresolvable_model_emits_nothing() {
    let rec = Recorder::new();
    let mut state = CodexSessionState {
        thread_id: Some("t1".to_string()),
        resolved_turn_model: None,
        ..Default::default()
    };

    handle_notification(
        "thread/tokenUsage/updated",
        &json!({
            "threadId": "t1",
            "tokenUsage": {
                "last": { "inputTokens": 1_000, "outputTokens": 50 },
            },
        }),
        &rec.sink(),
        &mut state,
    );

    assert_eq!(rec.context_usages().len(), 0);
}

#[test]
fn no_wire_window_and_a_model_absent_from_the_table_emits_nothing() {
    let rec = Recorder::new();
    let mut state = CodexSessionState {
        thread_id: Some("t1".to_string()),
        resolved_turn_model: Some("some-future-model".to_string()),
        ..Default::default()
    };

    handle_notification(
        "thread/tokenUsage/updated",
        &json!({
            "threadId": "t1",
            "tokenUsage": {
                "last": { "inputTokens": 1_000, "outputTokens": 50 },
            },
        }),
        &rec.sink(),
        &mut state,
    );

    assert_eq!(rec.context_usages().len(), 0);
}
