use super::idle_compaction_tests::fixture;
use super::idle_test_session::IdleTestSession;
use super::*;
use mainframe_types::sync::LockExt as _;

#[tokio::test(flavor = "multi_thread")]
async fn delayed_legacy_after_real_turn_start_keeps_one_idle_row() {
    use mainframe_adapter_codex::event_mapper::{CodexSessionState, handle_notification};
    let mut fake = IdleTestSession::new();
    fake.inner.adapter = Some("codex".into());
    let (manager, deps, session) = fixture(fake).await;
    let sink = session.sink.lock_recover().as_ref().unwrap().clone();
    let mut state = CodexSessionState::default();
    let request = idle_request(&manager, &deps, session.id());
    let receiver = state.maintenance.begin(request).unwrap();
    let surface = Arc::new(CompactionSurface::default());
    manager.event_handler.set_chat_surface(surface.clone());
    handle_notification(
        "item/completed",
        &serde_json::json!({"item":{"id":"A","type":"contextCompaction"}}),
        &sink,
        &mut state,
    );
    let outcome = state.maintenance.wait(receiver, 10).await.unwrap();
    assert_eq!(outcome.request_id, "idle");
    assert_eq!(deps.idle_markers("c").unwrap().len(), 1);
    handle_notification(
        "turn/started",
        &serde_json::json!({"turn":{"id":"real"}}),
        &sink,
        &mut state,
    );
    let before = surface.0.lock_recover().len();
    handle_notification(
        "thread/compacted",
        &serde_json::json!({}),
        &sink,
        &mut state,
    );
    assert_eq!(surface.0.lock_recover().len(), before);
    assert_eq!(deps.idle_markers("c").unwrap().len(), 1);
    assert!(!state.compaction_emitted);
    handle_notification(
        "thread/compacted",
        &serde_json::json!({}),
        &sink,
        &mut state,
    );
    assert!(state.compaction_emitted);
    assert_eq!(surface.0.lock_recover().len(), before + 1);
}

#[derive(Default)]
struct CompactionSurface(Mutex<Vec<crate::chat_surface::ChatSurfaceEvent>>);
impl crate::chat_surface::ChatSurface for CompactionSurface {
    fn on_chat_surface_event(&self, event: crate::chat_surface::ChatSurfaceEvent) {
        if matches!(
            event,
            crate::chat_surface::ChatSurfaceEvent::Compaction { .. }
        ) {
            self.0.lock_recover().push(event);
        }
    }
}

fn idle_request(
    manager: &ChatManager,
    deps: &crate::test_support::FakeDeps,
    session_id: &str,
) -> mainframe_types::compaction::NativeCompactionRequest {
    use mainframe_types::compaction::{CompactionOrigin, NativeCompactionRequest};
    let request = NativeCompactionRequest {
        id: "idle".into(),
        session_generation: session_id.into(),
        command_uuid: "internal".into(),
        origin: CompactionOrigin::Idle,
    };
    assert!(deps.idle_run_claim("c", "run", &request).unwrap());
    manager
        .shared
        .maintenance
        .requests
        .lock_recover()
        .insert("c".into(), request.clone());
    request
}
