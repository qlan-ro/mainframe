use super::idle_compaction_tests::{compactor, fixture};
use super::idle_test_session::IdleTestSession;
use super::*;
use crate::chat_surface::{ChatSurface, ChatSurfaceEvent};
use mainframe_types::{
    adapter::{ContextUsage, SessionResult},
    sync::LockExt as _,
};

#[derive(Default)]
struct Surface(Mutex<Vec<ChatSurfaceEvent>>);
impl ChatSurface for Surface {
    fn on_chat_surface_event(&self, event: ChatSurfaceEvent) {
        self.0.lock_recover().push(event);
    }
}
fn result() -> SessionResult {
    SessionResult {
        total_cost_usd: Some(100.0),
        context_tokens: Some(90_000),
        usage: None,
        subtype: Some("success".into()),
        is_error: Some(false),
        result: None,
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn idle_compaction_only_emits_display_and_keeps_real_activity() {
    let (manager, deps, session) = fixture(IdleTestSession::new()).await;
    let surface = Arc::new(Surface::default());
    manager.event_handler.set_chat_surface(surface.clone());
    *deps.push.task_complete.lock_recover() = true;
    *deps.push.session_error.lock_recover() = true;
    let worker = {
        let c = compactor(&manager);
        tokio::spawn(async move {
            c.evaluate("c").await;
        })
    };
    session.started.notified().await;
    let sink = session.sink.lock_recover().as_ref().unwrap().clone();
    assert_silent_callbacks(&deps, &session, &surface, &sink);
    let before = manager.shared.active("c").unwrap().lock_recover().clone();
    assert_eq!(before.last_used_at, 10);
    assert_eq!(before.chat.total_cost, 0.0);
    assert_eq!(before.chat.last_context_total_tokens, Some(20_000));
    let send = manager.lifecycle.begin_send("c").await;
    drop(send);
    let real_activity = manager
        .shared
        .active("c")
        .unwrap()
        .lock_recover()
        .last_used_at;
    session.finish.notify_one();
    worker.await.unwrap();
    assert_eq!(
        manager
            .shared
            .active("c")
            .unwrap()
            .lock_recover()
            .last_used_at,
        real_activity
    );
    assert_eq!(session.last_activity_at(), Some(100));
    sink.on_compact(Some("manual-after"));
    assert!(
        surface
            .0
            .lock_recover()
            .iter()
            .any(|e| matches!(e, ChatSurfaceEvent::Compaction { .. }))
    );
}

fn assert_silent_callbacks(
    deps: &crate::test_support::FakeDeps,
    session: &IdleTestSession,
    surface: &Surface,
    sink: &Arc<dyn mainframe_adapter_api::SessionSink>,
) {
    sink.on_result(result());
    sink.on_compact_start();
    sink.on_compact(Some("unmatched"));
    sink.on_cli_message("internal");
    sink.on_api_retry(1, None);
    sink.on_attention_request("internal");
    sink.on_message_partial("internal", Vec::new());
    sink.on_message(Vec::new(), None);
    sink.on_context_usage(ContextUsage {
        total_tokens: 99_000,
        max_tokens: 200_000,
        percentage: 49.5,
    });
    let request = session.requests.lock_recover()[0].clone();
    sink.on_compact_with_metadata(request.metadata(Some("boundary")));
    assert_eq!(deps.idle_markers("c").unwrap().len(), 1);
    assert!(deps.events().is_empty());
    assert!(deps.push.pushes().is_empty());
    assert!(
        surface
            .0
            .lock_recover()
            .iter()
            .all(|e| matches!(e, ChatSurfaceEvent::DisplayRevision { .. }))
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn idle_compaction_only_proven_success_arms_completion() {
    let (manager, deps, session) = fixture(IdleTestSession::new()).await;
    let sink = session.sink.lock_recover().as_ref().unwrap().clone();
    for (index, (subtype, error, interrupted, normal)) in [
        (None, None, false, false),
        (Some("unknown"), Some(false), false, false),
        (Some("success"), Some(true), false, false),
        (Some("success"), Some(false), true, false),
        (Some("success"), Some(false), false, true),
    ]
    .into_iter()
    .enumerate()
    {
        let generation = format!("outcome-{index}");
        deps.idle_run_begin("c", &generation).unwrap();
        manager
            .shared
            .active("c")
            .unwrap()
            .lock_recover()
            .real_run_generation = Some(generation);
        if interrupted {
            manager
                .shared
                .permissions
                .lock_recover()
                .mark_interrupted("c");
        }
        let mut data = result();
        data.subtype = subtype.map(str::to_owned);
        data.is_error = error;
        sink.on_result(data);
        assert_eq!(
            deps.idle_run_get("c")
                .unwrap()
                .unwrap()
                .completed_ms
                .is_some(),
            normal
        );
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn idle_compaction_interrupt_does_not_mark_next_real_run_interrupted() {
    let (manager, _, session) = fixture(IdleTestSession::new()).await;
    let worker = {
        let c = compactor(&manager);
        tokio::spawn(async move {
            c.evaluate("c").await;
        })
    };
    session.started.notified().await;
    manager.lifecycle.interrupt_chat("c").await;
    assert!(
        !manager
            .shared
            .permissions
            .lock_recover()
            .clear_interrupted("c")
    );
    session.finish.notify_one();
    worker.await.unwrap();
    session
        .ready
        .store(false, std::sync::atomic::Ordering::SeqCst);
    manager.lifecycle.interrupt_chat("c").await;
    assert!(
        !manager
            .shared
            .permissions
            .lock_recover()
            .clear_interrupted("c")
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn idle_compaction_archive_cancels_held_inputs_without_resuming_provider() {
    let (manager, deps, session) = fixture(IdleTestSession::new()).await;
    let worker = {
        let c = compactor(&manager);
        tokio::spawn(async move {
            c.evaluate("c").await;
        })
    };
    session.started.notified().await;
    manager
        .send_message("c", "cancel on archive", None, None)
        .await
        .unwrap();
    manager.archive_chat("c", false).await;
    session.finish.notify_one();
    worker.await.unwrap();
    assert!(deps.idle_queue_list("c").unwrap().is_empty());
    assert!(session.sent.lock_recover().is_empty());
    assert_eq!(
        deps.chats_get("c").unwrap().unwrap().status,
        ChatStatus::Archived
    );
    assert!(deps.adapters.created_sessions.lock_recover().is_empty());
}
