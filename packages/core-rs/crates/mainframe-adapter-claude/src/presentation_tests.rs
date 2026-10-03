mod lifecycle;
mod support;
use mainframe_types::transcript_presentation::PresentationPhase;
use serde_json::{Value, json};
use support::*;
#[test]
fn exact_final_blocks_require_successful_parent_result() {
    let session = session();
    let sink = RecordingSink::default();
    feed(
        &session,
        &sink,
        assistant("work", "entry-work", Value::Null),
    );
    feed(
        &session,
        &sink,
        assistant("final", "entry-final-1", Value::Null),
    );
    feed(
        &session,
        &sink,
        assistant("final", "entry-final-2", json!("end_turn")),
    );
    assert!(sink.updates.lock().unwrap().is_empty());
    feed(&session, &sink, result());
    let messages = sink.messages.lock().unwrap();
    assert_eq!(
        messages
            .iter()
            .map(|(_, id, _)| id.as_str())
            .collect::<Vec<_>>(),
        ["work", "final", "entry-final-2"]
    );
    assert!(
        messages
            .iter()
            .all(|(_, _, context)| !context.final_eligible)
    );
    assert_final_update(&sink);
}

#[test]
fn retained_partial_id_closes_final_after_tool_result_continuation() {
    let session = session();
    let sink = RecordingSink::default();
    feed(
        &session,
        &sink,
        assistant("work", "work-entry", Value::Null),
    );
    feed(
        &session,
        &sink,
        json!({"type":"user","session_id":"provider-session","message":{"content":[{"type":"tool_result","tool_use_id":"tool","content":"done"}]}}),
    );
    feed(
        &session,
        &sink,
        json!({"type":"stream_event","session_id":"provider-session","event":{"type":"message_start","message":{"id":"final"}}}),
    );
    feed(
        &session,
        &sink,
        assistant("final", "final-entry", Value::Null),
    );
    feed(
        &session,
        &sink,
        json!({"type":"stream_event","session_id":"provider-session","event":{"type":"message_delta","delta":{"stop_reason":"end_turn"}}}),
    );
    feed(&session, &sink, result());
    let updates = sink.updates.lock().unwrap();
    assert_eq!(
        updates
            .iter()
            .find(|u| u.presentation.final_eligible)
            .unwrap()
            .source_message_ids
            .as_ref()
            .unwrap(),
        &["final"]
    );
}

#[test]
fn steering_replay_retry_and_conflicting_sessions_cannot_be_repaired_by_success() {
    for ambiguity in [
        json!({"type":"user","message":{"content":"steering"}}),
        json!({"type":"user","isReplay":true,"uuid":"queued","message":{"content":"queued"}}),
        json!({"type":"system","subtype":"api_error","retry_attempt":1}),
        json!({"type":"assistant","session_id":"other","message":{"id":"foreign","content":[{"type":"text","text":"foreign"}]}}),
    ] {
        let session = session();
        let sink = RecordingSink::default();
        feed(
            &session,
            &sink,
            assistant("work", "work-entry", Value::Null),
        );
        feed(&session, &sink, ambiguity);
        feed(
            &session,
            &sink,
            assistant("final", "final-entry", json!("end_turn")),
        );
        feed(&session, &sink, result());
        let updates = sink.updates.lock().unwrap();
        assert!(updates.iter().any(|u| u.presentation.state
            == mainframe_types::transcript_presentation::PresentationState::Invalid));
        assert!(updates.iter().all(|u| !u.presentation.final_eligible));
    }
}

#[test]
fn conflicting_late_stop_reason_never_recovers_eligibility() {
    let session = session();
    let sink = RecordingSink::default();
    feed(
        &session,
        &sink,
        assistant("final", "entry-1", json!("end_turn")),
    );
    feed(
        &session,
        &sink,
        assistant("final", "entry-2", json!("tool_use")),
    );
    feed(&session, &sink, result());
    assert!(
        sink.updates
            .lock()
            .unwrap()
            .iter()
            .all(|u| !u.presentation.final_eligible)
    );
}

fn assert_final_update(sink: &RecordingSink) {
    let updates = sink.updates.lock().unwrap();
    let final_update = updates
        .iter()
        .find(|u| u.presentation.final_eligible)
        .unwrap();
    assert_eq!(
        final_update.source_message_ids.as_ref().unwrap(),
        &["final", "entry-final-2"]
    );
    assert_eq!(
        final_update.presentation.phase,
        Some(PresentationPhase::FinalAnswer)
    );
    assert_eq!(
        final_update
            .presentation
            .timing
            .as_ref()
            .unwrap()
            .duration_ms,
        Some(123)
    );
}
