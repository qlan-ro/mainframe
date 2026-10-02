use super::*;
#[test]
fn cancellation_and_failure_cannot_be_revived_by_stale_success() {
    for (status, expected) in [
        ("interrupted", PresentationState::Cancelled),
        ("failed", PresentationState::Failed),
    ] {
        let (s, mut state) = setup();
        send(&s, &mut state, "item/started", item(json!("final_answer")));
        delta(&s, &mut state);
        for status in [status, "completed"] {
            send(
                &s,
                &mut state,
                "turn/completed",
                json!({"threadId":"thread","turn":{"id":"turn","status":status,"items":[item(json!("final_answer"))["item"].clone()]}}),
            );
        }
        delta(&s, &mut state);
        let r = s.0.lock().unwrap();
        assert_eq!(r.partials.len(), 1);
        assert_eq!(r.updates.last().unwrap().presentation.state, expected);
    }
}
#[test]
fn contradictory_final_metadata_invalidates_the_turn_permanently() {
    let (s, mut state) = setup();
    send(&s, &mut state, "item/started", item(json!("final_answer")));
    delta(&s, &mut state);
    send(&s, &mut state, "item/completed", item(json!("commentary")));
    send(
        &s,
        &mut state,
        "item/completed",
        item(json!("final_answer")),
    );
    send(
        &s,
        &mut state,
        "turn/completed",
        json!({"threadId":"thread","turn":{"id":"turn","status":"completed"}}),
    );
    let r = s.0.lock().unwrap();
    assert_eq!(r.messages.len(), 1);
    assert_eq!(
        r.updates.last().unwrap().presentation.state,
        PresentationState::Invalid
    );
    assert!(
        r.updates.iter().any(|u| u.source_message_ids.is_none()
            && u.presentation.state == PresentationState::Invalid)
    );
}
#[test]
fn an_old_turn_cannot_clear_or_relabel_the_new_turn() {
    let (s, mut state) = setup();
    send(
        &s,
        &mut state,
        "turn/started",
        json!({"threadId":"thread","turn":{"id":"next"}}),
    );
    send(
        &s,
        &mut state,
        "turn/completed",
        json!({"threadId":"thread","turn":{"id":"turn","status":"completed"}}),
    );
    let mut next = item(json!("final_answer"));
    next["turnId"] = json!("next");
    send(&s, &mut state, "item/started", next);
    send(
        &s,
        &mut state,
        "item/agentMessage/delta",
        json!({"threadId":"thread","turnId":"next","itemId":"answer","delta":"next"}),
    );
    let r = s.0.lock().unwrap();
    assert_eq!(r.partials.len(), 1);
    assert_eq!(
        r.partials[0].2.as_ref().unwrap().turn_id,
        "[\"thread\",\"next\"]"
    );
    assert!(r.updates.is_empty());
}
#[test]
fn malformed_timing_does_not_remove_text_or_invent_a_clock() {
    let (s, mut state) = setup();
    send(
        &s,
        &mut state,
        "turn/started",
        json!({"threadId":"thread","turn":{"id":"next","startedAt":"bad","durationMs":-1}}),
    );
    let mut p = item(json!("final_answer"));
    p["turnId"] = json!("next");
    send(&s, &mut state, "item/completed", p);
    let r = s.0.lock().unwrap();
    assert_eq!(r.messages.len(), 1);
    assert!(r.messages[0].2.as_ref().unwrap().timing.is_none());
}
#[test]
fn clear_transient_removes_fold_eligibility_from_later_delivery() {
    let (s, mut state) = setup();
    send(&s, &mut state, "item/started", item(json!("final_answer")));
    state.clear_transient();
    delta(&s, &mut state);
    let r = s.0.lock().unwrap();
    assert_eq!(r.partials.len(), 1);
    assert!(r.partials[0].2.is_none());
}
#[test]
fn concurrent_children_have_distinct_parent_and_turn_membership() {
    let (s, mut state) = setup();
    for child in ["child-a", "child-b"] {
        send(
            &s,
            &mut state,
            "item/completed",
            json!({"threadId":"thread","turnId":"turn","item":{"type":"subAgentActivity","id":format!("open-{child}"),"kind":"started","agentThreadId":child,"agentPath":format!("/root/{child}")}}),
        );
        send(
            &s,
            &mut state,
            "turn/started",
            json!({"threadId":child,"turn":{"id":"same-child-turn"}}),
        );
        send(
            &s,
            &mut state,
            "item/completed",
            json!({"threadId":child,"turnId":"same-child-turn","item":{"type":"agentMessage","id":child,"text":child,"phase":"final_answer"}}),
        );
    }
    send(
        &s,
        &mut state,
        "turn/completed",
        json!({"threadId":"child-a","turn":{"id":"same-child-turn","status":"interrupted"}}),
    );
    let r = s.0.lock().unwrap();
    let children: Vec<_> = r
        .messages
        .iter()
        .filter(|m| matches!(m.0.as_deref(), Some("child-a" | "child-b")))
        .collect();
    assert_eq!(children.len(), 2);
    let a = children[0].2.as_ref().unwrap();
    let b = children[1].2.as_ref().unwrap();
    assert_ne!(a.turn_id, b.turn_id);
    assert_ne!(a.parent_tool_use_id, b.parent_tool_use_id);
    let parent = &children[0].1[0]["parentToolUseId"];
    assert_eq!(parent, &json!(a.parent_tool_use_id));
    let terminal = r
        .updates
        .iter()
        .find(|u| u.presentation.state == PresentationState::Cancelled)
        .unwrap();
    assert!(terminal.presentation.same_turn(a));
    assert!(!terminal.presentation.same_turn(b));
}
