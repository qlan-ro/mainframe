#[tokio::test]
async fn failed_shutdown_keeps_the_chat_and_its_session_until_a_later_success() {
    use std::sync::atomic::Ordering;

    let manager = ChatManager::new(FakeDeps::arc());
    let session = FakeSession::with_activity(true, Some(long_idle()));
    session.fail_kill.store(true, Ordering::SeqCst);
    let mut chat = test_chat("c1");
    chat.adapter_id = "codex".into();
    seed_active(&manager, "c1", chat, session.clone());

    manager.scan_idle_sessions().await;
    assert_eq!(session.kills(), 1);
    let live = manager.shared.active_chats.get("c1").unwrap();
    let stored = live.value().lock().unwrap().session.clone().unwrap();
    drop(live);
    let expected: std::sync::Arc<dyn mainframe_adapter_api::AdapterSession> = session.clone();
    assert!(std::sync::Arc::ptr_eq(&stored, &expected));

    session.fail_kill.store(false, Ordering::SeqCst);
    manager.scan_idle_sessions().await;
    assert_eq!(session.kills(), 2);
    assert!(!manager.shared.active_chats.contains_key("c1"));
}
