use super::*;
use crate::credentials::CredentialRegistry;

fn caller(registry: &CredentialRegistry, session: &str) -> Caller {
    let token = registry.issue("chat", session);
    registry.resolve(token.expose()).unwrap()
}

#[test]
fn a_cancel_notification_ends_only_the_named_call() {
    let registry = CredentialRegistry::default();
    let caller = caller(&registry, "s1");
    let first = CallCtx::begin(&caller, "n:1".into());
    let second = CallCtx::begin(&caller, "n:2".into());
    caller.calls.cancel("n:1");
    assert!(first.cancel.is_cancelled() && first.abandoned.is_cancelled());
    assert!(!second.cancel.is_cancelled());
}

#[test]
fn dropping_a_call_forgets_it() {
    let registry = CredentialRegistry::default();
    let caller = caller(&registry, "s1");
    let call = CallCtx::begin(&caller, "n:1".into());
    let token = call.cancel.clone();
    drop(call);
    caller.calls.cancel("n:1");
    assert!(
        !token.is_cancelled(),
        "a finished call has nothing to cancel"
    );
}

/// A respawned CLI counts its request ids from the start again.
#[test]
fn a_call_ending_on_a_replaced_credential_leaves_its_successors_call_alone() {
    let registry = CredentialRegistry::default();
    let old = CallCtx::begin(&caller(&registry, "s1"), "n:1".into());
    let successor = caller(&registry, "s2");
    let current = CallCtx::begin(&successor, "n:1".into());
    drop(old);
    successor.calls.cancel("n:1");
    assert!(current.cancel.is_cancelled());
}

#[test]
fn an_abandoned_call_ending_late_leaves_the_reuse_of_its_id_alone() {
    let registry = CredentialRegistry::default();
    let caller = caller(&registry, "s1");
    let abandoned = CallCtx::begin(&caller, "n:1".into());
    let current = CallCtx::begin(&caller, "n:1".into());
    drop(abandoned);
    caller.calls.cancel("n:1");
    assert!(current.cancel.is_cancelled());
}

#[test]
fn a_disconnect_abandons_the_call_without_cancelling_it() {
    let registry = CredentialRegistry::default();
    let call = CallCtx::begin(&caller(&registry, "s1"), "n:1".into());
    drop(call.abandon_on_drop());
    assert!(call.abandoned.is_cancelled());
    assert!(!call.cancel.is_cancelled());
}
