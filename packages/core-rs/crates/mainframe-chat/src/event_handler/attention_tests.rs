//! `SessionSinkImpl::on_attention_request` — the sink side of Claude's
//! `PushNotification` tool call: gate, dedupe, then notify+push.

use super::tests::Harness;
use super::*;
use crate::test_support::{FakeDeps, test_chat};

/// A sink over a fresh "chat-1", with the attention gate on.
fn sink() -> (Arc<dyn SessionSink>, Arc<FakeDeps>) {
    let h = Harness::new(Arc::new(Mutex::new(ActiveChat::new(
        test_chat("chat-1"),
        None,
    ))));
    (h.sink("chat-1"), h.deps)
}

fn pushes(deps: &FakeDeps) -> Vec<PushOut> {
    deps.push.pushes()
}

#[test]
fn one_call_raises_one_notification_and_push() {
    let (sink, deps) = sink();

    sink.on_attention_request("please confirm before I continue");

    assert_eq!(
        deps.events(),
        vec![DaemonEvent::ChatNotification {
            chat_id: "chat-1".to_string(),
            title: "Claude needs your attention".to_string(),
            body: "please confirm before I continue".to_string(),
            level: ChatNotificationLevel::Success,
            kind: Some(ChatNotificationKind::AttentionRequest),
        }]
    );
    assert_eq!(
        pushes(&deps),
        vec![PushOut {
            chat_id: "chat-1".to_string(),
            title: "Claude needs your attention".to_string(),
            body: "please confirm before I continue".to_string(),
            push_type: "attention_request".to_string(),
            priority: "high".to_string(),
        }]
    );
}

#[test]
fn toggling_the_setting_off_raises_nothing() {
    let (sink, deps) = sink();
    *deps.push.attention_request.lock().unwrap() = false;

    sink.on_attention_request("please confirm");

    assert!(deps.events().is_empty());
    assert!(pushes(&deps).is_empty());
}

#[test]
fn the_same_message_twice_is_deduped_to_one() {
    let (sink, deps) = sink();

    sink.on_attention_request("please confirm");
    sink.on_attention_request("please confirm");

    assert_eq!(deps.events().len(), 1);
    assert_eq!(pushes(&deps).len(), 1);
}

#[test]
fn empty_and_whitespace_only_raise_nothing() {
    let (sink, deps) = sink();

    sink.on_attention_request("");
    sink.on_attention_request("   \n\t ");

    assert!(deps.events().is_empty());
    assert!(pushes(&deps).is_empty());
}

#[test]
fn a_long_message_is_truncated_to_200_chars() {
    let (sink, deps) = sink();
    let long = "a".repeat(250);

    sink.on_attention_request(&long);

    let events = deps.events();
    let DaemonEvent::ChatNotification { body, .. } = &events[0] else {
        panic!("expected a ChatNotification");
    };
    assert_eq!(body.chars().count(), 200);
    assert!(body.ends_with('\u{2026}'));
}

/// Spec D7 / AC7: dedupe keys on exact message text, not the truncated
/// display body — two long messages sharing a 199-char prefix must not
/// collapse into one notification (regression for the truncated-key bug).
#[test]
fn two_long_messages_sharing_a_199_char_prefix_both_notify() {
    let (sink, deps) = sink();
    let prefix = "a".repeat(199);
    let first = format!("{prefix}1 tail that pushes it well past 200 chars total");
    let second = format!("{prefix}2 a completely different tail after the shared prefix");

    sink.on_attention_request(&first);
    sink.on_attention_request(&second);

    assert_eq!(deps.events().len(), 2);
    assert_eq!(pushes(&deps).len(), 2);
}

#[test]
fn attention_notification_precedes_the_next_sink_event() {
    let (sink, deps) = sink();
    sink.on_attention_request("please confirm");
    sink.on_init("next-session");
    assert!(matches!(
        &deps.events()[0],
        DaemonEvent::ChatNotification { .. }
    ));
    assert_eq!(pushes(&deps).len(), 1);
}
