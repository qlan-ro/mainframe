#![allow(clippy::unwrap_used, clippy::expect_used)]
#[path = "agent_message_presentation/lifecycle.rs"]
mod lifecycle;
#[path = "agent_message_presentation/support.rs"]
mod support;
use mainframe_types::transcript_presentation::*;
use serde_json::{Value, json};
use support::*;
#[test]
fn first_final_text_carries_scope_and_completion_replaces_once() {
    let (s, mut state) = setup();
    send(&s, &mut state, "item/started", item(json!("final_answer")));
    delta(&s, &mut state);
    send(
        &s,
        &mut state,
        "item/completed",
        item(json!("final_answer")),
    );
    delta(&s, &mut state);
    let r = s.0.lock().unwrap();
    assert_eq!(r.partials.len(), 1);
    assert_eq!(r.messages.len(), 1);
    assert_eq!(r.partials[0].0, "answer");
    assert_eq!(r.messages[0].0.as_deref(), Some("answer"));
    let p = r.partials[0].2.as_ref().expect("first text is contextual");
    assert_eq!(p.phase, Some(PresentationPhase::FinalAnswer));
    assert!(p.final_eligible);
    assert_eq!(p.state, PresentationState::Running);
    assert_eq!(p.timing.as_ref().unwrap().started_at_ms, Some(10000));
    assert_eq!(r.messages[0].2.as_ref(), Some(p));
}
#[test]
fn terminal_items_supply_late_phase_without_replaying_text() {
    let (s, mut state) = setup();
    delta(&s, &mut state);
    send(&s, &mut state, "item/completed", item(Value::Null));
    send(
        &s,
        &mut state,
        "turn/completed",
        json!({"threadId":"thread","turn":{"id":"turn","status":"completed","completedAt":12,"durationMs":1900,"items":[item(json!("final_answer"))["item"].clone()]}}),
    );
    let r = s.0.lock().unwrap();
    assert_eq!(r.messages.len(), 1);
    assert!(!r.partials[0].2.as_ref().unwrap().final_eligible);
    let late = r
        .updates
        .iter()
        .find(|u| {
            u.source_message_ids.as_ref() == Some(&vec!["answer".into()])
                && u.presentation.final_eligible
        })
        .expect("exact late final update");
    assert_eq!(
        late.presentation.phase,
        Some(PresentationPhase::FinalAnswer)
    );
    let terminal = r.updates.last().unwrap();
    assert_eq!(terminal.presentation.state, PresentationState::Completed);
    assert_eq!(
        terminal.presentation.timing.as_ref().unwrap().duration_ms,
        Some(1900)
    );
}
#[test]
fn unsupported_optional_fields_never_drop_text_or_create_a_final() {
    for fields in [
        json!({"phase":"future"}),
        json!({"phase":42}),
        json!({"delivery":"async"}),
        json!({"delivery":"future"}),
        json!({"questions":[{"title":"Choose","options":["one"]}]}),
        json!({"questions":false}),
    ] {
        let (s, mut state) = setup();
        let mut p = item(json!("final_answer"));
        p["item"]
            .as_object_mut()
            .unwrap()
            .extend(fields.as_object().unwrap().clone());
        send(&s, &mut state, "item/started", p.clone());
        delta(&s, &mut state);
        send(&s, &mut state, "item/completed", p);
        let r = s.0.lock().unwrap();
        assert_eq!(r.messages.len(), 1);
        assert_eq!(r.messages[0].1[0]["text"], "Hello");
        assert!(!r.partials[0].2.as_ref().unwrap().final_eligible);
        assert!(!r.messages[0].2.as_ref().unwrap().final_eligible);
    }
}
#[test]
fn late_started_metadata_updates_the_existing_partial() {
    let (s, mut state) = setup();
    delta(&s, &mut state);
    send(&s, &mut state, "item/started", item(json!("final_answer")));
    let r = s.0.lock().unwrap();
    assert_eq!(r.partials.len(), 1);
    assert!(r.updates.iter().any(|u| u.source_message_ids.as_ref()
        == Some(&vec!["answer".into()])
        && u.presentation.final_eligible));
}
