use super::support::*;
use mainframe_types::transcript_presentation::PresentationState;
use serde_json::{Value, json};

#[tokio::test]
async fn interrupt_and_kill_prevent_late_success_from_closing_work() {
    for interrupt in [true, false] {
        let session = session();
        let sink = RecordingSink::default();
        feed(&session, &sink, assistant("work", "entry", Value::Null));
        if interrupt {
            session.interrupt().await.unwrap();
        } else {
            session.kill().await.unwrap();
        }
        feed(
            &session,
            &sink,
            assistant("final", "final-entry", json!("end_turn")),
        );
        feed(&session, &sink, result());
        let updates = sink.updates.lock().unwrap();
        assert!(updates.iter().all(|u| !u.presentation.final_eligible));
        assert!(
            updates
                .iter()
                .any(|u| u.presentation.state == PresentationState::Invalid)
        );
    }
}

#[test]
fn result_requires_explicit_success_and_matching_session() {
    for change in [
        json!({"is_error":true}),
        json!({"subtype":"error_during_execution"}),
        json!({"session_id":"foreign"}),
        json!({"is_error":null}),
    ] {
        let session = session();
        let sink = RecordingSink::default();
        feed(
            &session,
            &sink,
            assistant("final", "entry", json!("end_turn")),
        );
        let mut terminal = result();
        terminal
            .as_object_mut()
            .unwrap()
            .extend(change.as_object().unwrap().clone());
        feed(&session, &sink, terminal);
        feed(&session, &sink, result());
        assert!(
            sink.updates
                .lock()
                .unwrap()
                .iter()
                .all(|u| !u.presentation.final_eligible)
        );
    }
}

#[test]
fn invalid_or_missing_duration_does_not_invent_a_clock() {
    for duration in [
        Value::Null,
        json!(-1),
        json!(1.5),
        json!("123"),
        json!(9_007_199_254_740_992_u64),
    ] {
        let session = session();
        let sink = RecordingSink::default();
        feed(
            &session,
            &sink,
            assistant("final", "entry", json!("end_turn")),
        );
        let mut terminal = result();
        terminal["duration_ms"] = duration;
        feed(&session, &sink, terminal);
        let updates = sink.updates.lock().unwrap();
        let completed = updates
            .iter()
            .find(|u| u.presentation.final_eligible)
            .unwrap();
        assert!(completed.presentation.timing.is_none());
    }
}

#[test]
fn terminal_duplicates_cannot_reopen_a_completed_epoch() {
    let session = session();
    let sink = RecordingSink::default();
    feed(
        &session,
        &sink,
        assistant("first", "entry", json!("end_turn")),
    );
    feed(&session, &sink, result());
    feed(
        &session,
        &sink,
        assistant("first", "entry", json!("end_turn")),
    );
    feed(&session, &sink, result());
    feed(
        &session,
        &sink,
        assistant("second", "entry-2", json!("end_turn")),
    );
    feed(&session, &sink, result());
    let updates = sink.updates.lock().unwrap();
    let finals: Vec<_> = updates
        .iter()
        .filter(|u| u.presentation.final_eligible)
        .collect();
    assert_eq!(finals.len(), 2);
    assert_ne!(
        finals[0].presentation.turn_id,
        finals[1].presentation.turn_id
    );
}

#[test]
fn process_exit_revokes_unfinished_epoch_but_preserves_closed_success() {
    let session = session();
    let sink = RecordingSink::default();
    feed(
        &session,
        &sink,
        assistant("closed", "closed-entry", json!("end_turn")),
    );
    feed(&session, &sink, result());
    feed(
        &session,
        &sink,
        assistant("pending", "pending-entry", json!("end_turn")),
    );
    session.process_exited(&sink);
    feed(&session, &sink, result());
    let updates = sink.updates.lock().unwrap();
    let closed = "[\"provider-session\",\"closed\"]";
    assert!(
        updates
            .iter()
            .filter(|u| u.presentation.turn_id == closed)
            .all(|u| u.presentation.state == PresentationState::Completed)
    );
    assert!(
        updates.iter().any(|u| u.presentation.turn_id != closed
            && u.presentation.state == PresentationState::Invalid)
    );
    assert!(
        updates
            .iter()
            .filter(|u| u.presentation.turn_id != closed)
            .all(|u| !u.presentation.final_eligible)
    );
}
