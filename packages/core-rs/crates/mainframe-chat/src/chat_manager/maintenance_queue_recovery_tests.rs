use super::super::idle_compaction_tests::fixture;
use super::super::idle_test_session::IdleTestSession;
use super::super::maintenance_queue::wait_tests::finish_turn;
use super::*;
use crate::chat_surface::{ChatSurface, ChatSurfaceEvent};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

#[derive(Default)]
struct StartedTurns(AtomicUsize);

impl ChatSurface for StartedTurns {
    fn on_chat_surface_event(&self, event: ChatSurfaceEvent) {
        if matches!(event, ChatSurfaceEvent::TurnStarted { .. }) {
            self.0.fetch_add(1, Ordering::Relaxed);
        }
    }
}

async fn dispatch_without_echo() -> (Arc<ChatManager>, Arc<IdleTestSession>, String, String) {
    dispatch_with_write_guard(false).await
}

async fn dispatch_with_write_guard(
    capture_guard: bool,
) -> (Arc<ChatManager>, Arc<IdleTestSession>, String, String) {
    let mut fake = IdleTestSession::new();
    fake.capture_guard = capture_guard;
    fake.acknowledge_by_echo = true;
    let (manager, _, session) = fixture(fake).await;
    assert!(manager.shared.manager.set(Arc::downgrade(&manager)).is_ok());
    let first = manager
        .enqueue_maintenance_input("c", "first", None, None)
        .await
        .unwrap();
    manager
        .enqueue_maintenance_input("c", "second", None, None)
        .await
        .unwrap();
    manager.drain_maintenance_queue("c").await.unwrap();
    let uuid = manager.get_queued_for_chat("c")[0].uuid.clone();
    (manager, session, first, uuid)
}

async fn time_out(manager: &ChatManager) {
    tokio::time::advance(Duration::from_secs(29)).await;
    assert!(manager.get_queued_for_chat("c")[0].delivery.is_none());
    tokio::time::advance(Duration::from_secs(1)).await;
    tokio::task::yield_now().await;
    assert_eq!(
        manager.get_queued_for_chat("c")[0].delivery.as_deref(),
        Some("unconfirmed")
    );
}

async fn assert_next(session: &IdleTestSession, expected: &str) {
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if let Some(sent) = session.sent.lock_recover().get(1) {
                assert_eq!(sent.0, expected);
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test(start_paused = true)]
async fn late_acknowledgement_keeps_position_and_wakes_queue_after_result() {
    let (manager, session, first, uuid) = dispatch_without_echo().await;
    time_out(&manager).await;
    let sink = session.sink.lock_recover().as_ref().unwrap().clone();
    finish_turn(&session, false);
    tokio::task::yield_now().await;
    assert_eq!(session.sent.lock_recover().len(), 1);
    let index = |manager: &ChatManager| {
        manager
            .shared
            .messages
            .lock_recover()
            .get("c")
            .unwrap()
            .iter()
            .position(|message| message.id == first)
            .unwrap()
    };
    let started = Arc::new(StartedTurns::default());
    manager.event_handler.set_chat_surface(started.clone());
    let before = index(&manager);
    sink.on_queued_processed(&uuid);
    assert_eq!(index(&manager), before);
    assert_next(&session, "second").await;
    assert_eq!(started.0.load(Ordering::Relaxed), 0);
}

#[tokio::test]
async fn exit_exposes_uncertainty_and_resume_keeps_pause_until_head_is_removed() {
    let (manager, session, first, _) = dispatch_without_echo().await;
    let sink = session.sink.lock_recover().as_ref().unwrap().clone();
    sink.on_exit(Some(1));
    assert_eq!(
        manager.get_queued_for_chat("c")[0].delivery.as_deref(),
        Some("unconfirmed")
    );
    manager.resume_maintenance_queue("c").await.unwrap();
    assert!(manager.cancel_queued_message("c", &first).await.unwrap());
    let refs = manager.get_queued_for_chat("c");
    assert_eq!(refs.len(), 1);
    assert_eq!(refs[0].pause_reason.as_deref(), Some("Session ended"));
    assert_eq!(session.sent.lock_recover().len(), 1);
}

#[tokio::test(start_paused = true)]
async fn confirming_uncertain_head_keeps_sent_message_and_advances_queue() {
    let (manager, session, first, _) = dispatch_without_echo().await;
    time_out(&manager).await;
    manager.confirm_uncertain_input("c", &first).await.unwrap();
    {
        let messages = manager.shared.messages.lock_recover();
        let message = messages
            .get("c")
            .unwrap()
            .iter()
            .find(|m| m.id == first)
            .unwrap();
        assert!(message.metadata.as_ref().unwrap().get("queued").is_none());
    }
    finish_turn(&session, false);
    assert_next(&session, "second").await;
}

#[tokio::test(start_paused = true)]
async fn dismissing_uncertain_head_wakes_unpaused_queue_without_replaying() {
    let (manager, session, first, _) = dispatch_without_echo().await;
    time_out(&manager).await;
    finish_turn(&session, false);
    assert!(manager.cancel_queued_message("c", &first).await.unwrap());
    assert_next(&session, "second").await;
}

#[tokio::test]
async fn acknowledgement_after_result_can_continue_before_the_timeout() {
    let (manager, session, _, uuid) = dispatch_without_echo().await;
    let sink = session.sink.lock_recover().as_ref().unwrap().clone();
    finish_turn(&session, false);
    tokio::task::yield_now().await;
    assert!(manager.get_queued_for_chat("c")[0].delivery.is_none());
    sink.on_queued_processed(&uuid);
    assert_next(&session, "second").await;
}

#[tokio::test]
async fn stop_prevents_a_queued_line_waiting_in_the_writer() {
    let (manager, session, _, _) = dispatch_with_write_guard(true).await;
    manager.interrupt_chat("c").await;
    let guard = session.write_guard.lock_recover().take().unwrap();
    assert!(!guard());
    assert!(manager.get_queued_for_chat("c")[0].delivery.is_none());
    assert_eq!(
        manager.get_queued_for_chat("c")[0].pause_reason.as_deref(),
        Some("Stopped")
    );
}

#[tokio::test]
async fn cold_pending_queue_has_a_resume_control() {
    let (manager, deps, _) = fixture(IdleTestSession::new()).await;
    manager
        .enqueue_maintenance_input("c", "held across restart", None, None)
        .await
        .unwrap();
    let reloaded = ChatManager::new(deps);
    reloaded.shared.merge_idle_history("c", Vec::new()).unwrap();
    assert_eq!(
        reloaded.get_queued_for_chat("c")[0].pause_reason.as_deref(),
        Some("Session ended")
    );
}

#[tokio::test(start_paused = true)]
async fn confirming_uncertain_head_preserves_stop_until_resume() {
    let (manager, session, first, _) = dispatch_without_echo().await;
    time_out(&manager).await;
    finish_turn(&session, false);
    manager.interrupt_chat("c").await;
    manager.confirm_uncertain_input("c", &first).await.unwrap();
    tokio::task::yield_now().await;
    let refs = manager.get_queued_for_chat("c");
    assert_eq!(refs.len(), 1);
    assert_eq!(refs[0].pause_reason.as_deref(), Some("Stopped"));
    assert_eq!(session.sent.lock_recover().len(), 1);
    manager.resume_maintenance_queue("c").await.unwrap();
    assert_next(&session, "second").await;
}
