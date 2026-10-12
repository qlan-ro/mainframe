use mainframe_types::settings::ExecutionMode;

use super::*;
use crate::outbox::OutboxKind;
use crate::test_support::{FakePort, service_with};

#[tokio::test]
async fn held_messages_flush_as_one_batch_only_when_idle() {
    let port = FakePort::new();
    let mut target = port.add_chat("target");
    target.working = true;
    port.put(target);
    port.add_chat("caller");
    port.add_chat("a");
    port.add_chat("b");
    let (svc, _ctx) = service_with(port.clone(), "caller");
    svc.outbox
        .push("target", "a", OutboxKind::Send, "one".into(), "one");
    svc.outbox
        .push("target", "b", OutboxKind::Send, "two".into(), "two");
    svc.try_flush("target").await;
    assert!(port.lock().sent.is_empty());
    port.update("target", |c| c.working = false);
    svc.on_event(&DaemonEvent::ChatUpdated {
        chat: crate::test_support::wire_chat("target"),
        reason: None,
    })
    .await;
    assert_eq!(
        port.lock().sent,
        vec![("target".to_string(), "one\n\ntwo".to_string())]
    );
    assert!(!svc.outbox.has_for("target"));
}

#[tokio::test]
async fn holding_and_flushing_reannounce_the_target() {
    let port = FakePort::new();
    port.add_chat("target");
    port.add_chat("caller");
    port.add_chat("a");
    let (svc, _ctx) = service_with(port.clone(), "caller");
    svc.outbox
        .push("target", "a", OutboxKind::Send, "one".into(), "one");
    assert_eq!(port.lock().changed, vec!["target"]);
    svc.try_flush("target").await;
    assert_eq!(port.lock().changed, vec!["target", "target"]);
    assert_eq!(port.lock().sent.len(), 1);
}

#[tokio::test]
async fn a_cancelled_entry_is_never_sent() {
    let port = FakePort::new();
    port.add_chat("caller");
    let (svc, _ctx) = service_with(port.clone(), "caller");
    let id = svc
        .outbox
        .push("caller", "x", OutboxKind::Send, "hi".into(), "hi");
    let held = svc.agent_outbox("caller");
    assert_eq!(held.len(), 1);
    assert_eq!(
        (held[0].from_chat_id.as_str(), held[0].preview.as_str()),
        ("x", "hi")
    );
    assert!(svc.cancel_outbox_entry("caller", &id).await);
    assert!(!svc.cancel_outbox_entry("caller", &id).await);
    svc.try_flush("caller").await;
    assert!(port.lock().sent.is_empty());
}

/// The ceiling is checked once, at `chat_send` time; a queued entry's
/// sender or target may have its mode raised or lowered before the
/// target actually goes idle and the entry is flushed. A sender that no
/// longer passes must not have its message delivered.
#[tokio::test]
async fn a_queued_send_that_no_longer_passes_the_ceiling_is_dropped_not_delivered() {
    let port = FakePort::new();
    let mut sender = port.add_chat("sender");
    sender.permission_mode = ExecutionMode::Default;
    port.put(sender);
    let mut target = port.add_chat("target");
    target.working = true;
    port.put(target);
    let (svc, _ctx) = service_with(port.clone(), "sender");
    svc.outbox
        .push("target", "sender", OutboxKind::Send, "hi".into(), "hi");

    // The target is raised above the sender's mode while the entry sits
    // queued, then goes idle.
    port.update("target", |c| {
        c.working = false;
        c.permission_mode = ExecutionMode::Yolo;
    });
    svc.try_flush("target").await;

    // The sender was told `delivery: "queued"` with an `outboxEntryId`
    // and has no other way to learn the message died: a `Notice` entry
    // rides the same outbox back to it. The sender is already idle, and
    // nothing else will ever flush it on its behalf, so `try_flush`
    // itself must deliver the notice — not just this test calling it a
    // second time by hand.
    let sent = port.lock().sent.clone();
    assert_eq!(
        sent,
        sent.iter()
            .filter(|(id, _)| id == "sender")
            .cloned()
            .collect::<Vec<_>>(),
        "the raised target must not receive it; only the sender's own notice is sent"
    );
    assert_eq!(
        sent.len(),
        1,
        "the idle sender must be flushed automatically"
    );
    let (notice_target, notice_body) = &sent[0];
    assert_eq!(notice_target, "sender");
    assert!(notice_body.contains("<mainframe-agent-message"));
    assert!(notice_body.contains("kind=\"dropped\""));

    assert!(
        !svc.outbox.has_for("target"),
        "the dropped entry is not kept for a retry"
    );
    assert!(
        !svc.outbox.has_for("sender"),
        "the notice was delivered, not left queued"
    );
}

/// The companion case: nothing changed, so the queued send still
/// delivers normally — the re-check must not be a no-op that always
/// refuses.
#[tokio::test]
async fn a_queued_send_that_still_passes_the_ceiling_delivers_normally() {
    let port = FakePort::new();
    port.add_chat("sender");
    let mut target = port.add_chat("target");
    target.working = true;
    port.put(target);
    let (svc, _ctx) = service_with(port.clone(), "sender");
    svc.outbox
        .push("target", "sender", OutboxKind::Send, "hi".into(), "hi");

    port.update("target", |c| c.working = false);
    svc.try_flush("target").await;

    assert_eq!(
        port.lock().sent,
        vec![("target".to_string(), "hi".to_string())]
    );
}

/// Discard deletes the chat row before emitting `ChatEnded`
/// (`chat_manager/discard.rs`), so `port.chat` reads `None` by the time
/// the orchestration event loop sees it. The stopping flag must still
/// clear, or it leaks for the rest of the process (the chat can never
/// run another turn to go idle on).
#[tokio::test]
async fn a_discarded_chats_stopping_flag_clears_even_though_its_row_is_gone() {
    let port = FakePort::new();
    port.add_chat("caller");
    let (svc, _ctx) = service_with(port.clone(), "caller");
    svc.mark_stopping("gone");
    port.remove("gone");
    svc.on_event(&DaemonEvent::ChatEnded {
        chat_id: "gone".to_string(),
    })
    .await;
    assert!(!svc.is_stopping("gone"));
}

#[tokio::test]
async fn process_exit_revokes_the_matching_credential() {
    let port = FakePort::new();
    port.add_chat("caller");
    let (svc, ctx) = service_with(port, "caller");
    svc.on_event(&DaemonEvent::ProcessStopped {
        process_id: "session-caller".into(),
    })
    .await;
    assert!(!svc.credentials().has_credential("caller"));
    assert!(ctx.cancel.is_cancelled());
}
