use super::*;

#[test]
fn the_first_answer_on_a_chat_may_apply() {
    let mut reg = GateRegistry::new();
    assert_eq!(reg.claim("c1", "req_1"), AnswerOutcome::Apply);
}

#[test]
fn a_second_facade_client_answering_the_same_request_is_already_resolved() {
    let mut reg = GateRegistry::new();
    assert_eq!(reg.claim("c1", "req_1"), AnswerOutcome::Apply);
    // A second attempt to claim the SAME still-in-flight request, before
    // anyone has marked it resolved (e.g. two facade clients racing).
    assert_eq!(reg.claim("c1", "req_1"), AnswerOutcome::AlreadyResolved);
}

#[test]
fn a_late_answer_after_resolution_is_already_resolved() {
    let mut reg = GateRegistry::new();
    reg.claim("c1", "req_1");
    reg.mark_resolved("c1", "req_1");
    assert_eq!(reg.claim("c1", "req_1"), AnswerOutcome::AlreadyResolved);
}

#[test]
fn a_legacy_surface_answer_resolves_the_gate_for_a_facade_client_that_never_claimed_it() {
    let mut reg = GateRegistry::new();
    // The legacy WS surface answered directly (never went through `claim`);
    // its `GateResolved` chat-surface event is what calls `mark_resolved`.
    reg.mark_resolved("c1", "req_1");
    assert_eq!(reg.claim("c1", "req_1"), AnswerOutcome::AlreadyResolved);
}

#[test]
fn a_different_chats_request_is_unaffected() {
    let mut reg = GateRegistry::new();
    reg.mark_resolved("c1", "req_1");
    assert_eq!(reg.claim("c2", "req_1"), AnswerOutcome::Apply);
}

#[test]
fn a_new_request_on_the_same_chat_after_resolution_may_apply() {
    let mut reg = GateRegistry::new();
    reg.claim("c1", "req_1");
    reg.mark_resolved("c1", "req_1");
    assert_eq!(reg.claim("c1", "req_2"), AnswerOutcome::Apply);
}

#[test]
fn forgetting_a_chat_drops_its_claims_and_resolutions() {
    let mut reg = GateRegistry::new();
    reg.claim("c1", "req_1");
    reg.mark_resolved("c1", "req_1");
    reg.forget_chat("c1");
    assert_eq!(reg.claim("c1", "req_1"), AnswerOutcome::Apply);
}

#[test]
fn resolved_memory_is_bounded_per_chat() {
    let mut reg = GateRegistry::new();
    for i in 0..40 {
        reg.mark_resolved("c1", &format!("req_{i}"));
    }
    // The oldest ids fell off the ring; a late answer for one of them is no
    // longer distinguishable from a never-seen request — it is free to
    // claim, matching `PermissionManager::was_cancelled`'s bounded-memory
    // tradeoff (a sufficiently late duplicate is vanishingly unlikely).
    assert_eq!(reg.claim("c1", "req_0"), AnswerOutcome::Apply);
    assert!(reg.is_resolved("c1", "req_39"));
}
