use super::*;

#[tokio::test]
async fn validation_survives_restart_but_rejects_changed_sources() {
    let dir = tempfile::tempdir().unwrap();
    let (deps, manager, transcript) = cold_manager(&dir).await;
    manager.load_chat("c1").await;
    let validation = manager.history_validation("c1").unwrap();
    assert!(manager.validate_history("c1", &validation).await);
    let persisted = serde_json::to_vec(&validation).unwrap();
    let persisted = serde_json::from_slice(&persisted).unwrap();
    let restarted = ChatManager::new(deps);
    assert!(restarted.validate_initial_history("c1", &persisted).await);
    tokio::fs::write(transcript, "changed").await.unwrap();
    assert!(!restarted.validate_initial_history("c1", &persisted).await);
    manager.dispose();
    restarted.dispose();
}

#[tokio::test]
async fn local_edits_and_canonical_restoration_disable_the_initial_tail() {
    let dir = tempfile::tempdir().unwrap();
    let (_, manager, _) = cold_manager(&dir).await;
    manager.load_chat("c1").await;
    let validation = manager.history_validation("c1").unwrap();
    assert!(!manager.validate_initial_history("c1", &validation).await);
    manager
        .shared
        .messages
        .lock()
        .unwrap()
        .append("c1", history());
    assert!(manager.history_validation("c1").is_none());
    assert!(!manager.validate_history("c1", &validation).await);
    manager.dispose();
}

#[tokio::test]
async fn unanswered_permissions_cannot_be_mislabeled_after_the_gate_is_cleared() {
    let dir = tempfile::tempdir().unwrap();
    let (deps, manager, _) = cold_manager(&dir).await;
    let mut message = history();
    message.content = serde_json::from_value(json!([
        {"type":"tool_use","id":"tool-1","name":"Bash","input":{"command":"pwd"}}
    ]))
    .unwrap();
    *deps.adapters.history.lock().unwrap() = Some(vec![message]);
    manager.load_chat("c1").await;
    assert!(manager.shared.permissions.lock().unwrap().has_pending("c1"));
    assert!(manager.history_validation("c1").is_none());
    manager.shared.permissions.lock().unwrap().clear("c1");
    assert!(manager.history_validation("c1").is_none());
    manager.dispose();
}

#[derive(Default)]
struct ResyncCounter(std::sync::atomic::AtomicUsize);
impl crate::chat_surface::ChatSurface for ResyncCounter {
    fn on_chat_surface_event(&self, event: crate::chat_surface::ChatSurfaceEvent) {
        if matches!(event, crate::chat_surface::ChatSurfaceEvent::Resync { .. }) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }
}

async fn served_fixture() -> (
    tempfile::TempDir,
    Arc<FakeDeps>,
    ChatManager,
    PathBuf,
    Arc<ResyncCounter>,
) {
    let dir = tempfile::tempdir().unwrap();
    let (deps, manager, source) = cold_manager(&dir).await;
    manager.load_chat("c1").await;
    manager.shared.history_cache.flush().await;
    let proof = serde_json::from_slice(
        &serde_json::to_vec(&manager.history_validation("c1").unwrap()).unwrap(),
    )
    .unwrap();
    manager.dispose();
    let surface = Arc::new(ResyncCounter::default());
    let restarted = ChatManager::new(deps.clone()).with_chat_surface(surface.clone());
    restarted.mark_initial_history_served("c1", proof);
    (dir, deps, restarted, source, surface)
}

#[tokio::test]
async fn first_send_after_a_persisted_tail_restores_without_resetting_the_display() {
    let (_dir, deps, manager, _source, surface) = served_fixture().await;
    deps.set_spawn_ok(true);
    manager
        .send_message("c1", "next", None, None)
        .await
        .unwrap();
    assert_eq!(surface.0.load(Ordering::SeqCst), 0);
    assert!(deps.adapters.history_loads.load(Ordering::SeqCst) >= 1);
    manager.dispose();
}

#[tokio::test]
async fn changed_history_still_resets_a_previously_served_tail() {
    let (_dir, deps, manager, source, surface) = served_fixture().await;
    tokio::fs::write(source, "changed after tail delivery")
        .await
        .unwrap();
    let mut changed = history();
    changed.id = "updated".into();
    *deps.adapters.history.lock().unwrap() = Some(vec![changed]);
    manager.load_chat("c1").await;
    assert_eq!(surface.0.load(Ordering::SeqCst), 1);
    manager.dispose();
}

#[tokio::test]
async fn a_tail_open_publishes_stored_todos_without_loading_history() {
    let dir = tempfile::tempdir().unwrap();
    let (deps, manager, _) = cold_manager(&dir).await;
    let mut chat = test_chat("c1");
    chat.todos = Some(vec![
        serde_json::from_value(json!({
            "content":"restore history", "status":"pending", "activeForm":"restoring history"
        }))
        .unwrap(),
    ]);
    deps.store.insert(chat);
    manager.publish_initial_history_state("c1");
    assert!(deps.events().iter().any(|event| matches!(event,
        mainframe_types::events::DaemonEvent::TodosUpdated {chat_id, todos}
        if chat_id == "c1" && todos[0].content == "restore history")));
    assert_eq!(deps.adapters.history_loads.load(Ordering::SeqCst), 0);
    manager.dispose();
}

#[tokio::test]
async fn an_unvalidated_reload_cannot_reuse_an_old_served_proof() {
    let dir = tempfile::tempdir().unwrap();
    let (deps, manager, _) = cold_manager(&dir).await;
    manager.load_chat("c1").await;
    let proof = manager.history_validation("c1").unwrap();
    manager.mark_initial_history_served("c1", proof);
    deps.set_history_sources(Vec::new());
    let chat = manager.get_chat("c1").unwrap();
    let session =
        crate::chat_manager::build_history_session(&manager.shared.deps, &chat, "c1").unwrap();
    manager
        .shared
        .load_cached_history("c1", session.as_ref())
        .await
        .unwrap();
    assert!(manager.shared.history_cache.validation("c1").is_none());
    assert!(!manager.shared.history_cache.consume_served("c1"));
    manager.dispose();
}
