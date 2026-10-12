use super::*;

#[test]
fn issue_revokes_the_previous_credential_and_cancels_its_calls() {
    let reg = CredentialRegistry::new();
    let first = reg.issue("chat", "s1");
    let caller = reg.resolve(first.expose()).unwrap();
    let second = reg.issue("chat", "s2");
    assert!(caller.cancel.is_cancelled());
    assert!(reg.resolve(first.expose()).is_none());
    assert_eq!(reg.resolve(second.expose()).unwrap().session_id, "s2");
}

#[test]
fn resolve_matches_only_the_exact_token() {
    let reg = CredentialRegistry::new();
    let token = reg.issue("chat", "s1");
    assert!(reg.resolve("not-the-token").is_none());
    let mut tampered = token.expose().to_string();
    tampered.push('x');
    assert!(reg.resolve(&tampered).is_none());
    assert_eq!(reg.resolve(token.expose()).unwrap().chat_id, "chat");
}

#[test]
fn revoke_cancels_inflight_tokens() {
    let reg = CredentialRegistry::new();
    let token = reg.issue("chat", "s1");
    let caller = reg.resolve(token.expose()).unwrap();
    reg.revoke_chat("chat");
    assert!(caller.cancel.is_cancelled());
    assert!(reg.resolve(token.expose()).is_none());
}

#[test]
fn a_stale_session_exit_does_not_revoke_its_successor() {
    let reg = CredentialRegistry::new();
    reg.issue("chat", "old");
    let token = reg.issue("chat", "new");
    reg.revoke_by_session_id("old");
    assert!(reg.resolve(token.expose()).is_some());
    reg.revoke_by_session_id("new");
    assert!(reg.resolve(token.expose()).is_none());
}

#[test]
fn cancel_inflight_keeps_the_credential_usable() {
    let reg = CredentialRegistry::new();
    let token = reg.issue("chat", "s1");
    let before = reg.resolve(token.expose()).unwrap();
    reg.cancel_inflight("chat");
    assert!(before.cancel.is_cancelled());
    let after = reg.resolve(token.expose()).unwrap();
    assert!(!after.cancel.is_cancelled());
}

#[test]
fn wait_slots_are_bounded_and_released_on_drop() {
    let reg = CredentialRegistry::new();
    let token = reg.issue("chat", "s1");
    let caller = reg.resolve(token.expose()).unwrap();
    let slots: Vec<_> = (0..MAX_CONCURRENT_WAITS)
        .map(|_| caller.try_begin_wait().unwrap())
        .collect();
    assert!(caller.try_begin_wait().is_none());
    drop(slots);
    assert!(caller.try_begin_wait().is_some());
}

#[test]
fn debug_output_never_contains_the_raw_token() {
    let reg = CredentialRegistry::new();
    let token = reg.issue("chat", "s1");
    let caller = reg.resolve(token.expose()).unwrap();
    assert!(!format!("{token:?} {caller:?}").contains(token.expose()));
}
