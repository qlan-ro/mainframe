use super::*;
use std::time::Duration;
use tokio::sync::Notify;

fn fixture(
    history: Vec<ChatMessage>,
) -> (
    Arc<FakeDeps>,
    Arc<ChatManager>,
    Arc<Notify>,
    Arc<RecordingSurface>,
) {
    let mut chat = test_chat("c1");
    chat.vendor_session_id = Some("sess-1".into());
    let deps = FakeDeps::with_chats(vec![chat]);
    *deps.adapters.history.lock().unwrap() = Some(history);
    *deps.adapters.transcript_present.lock().unwrap() = Some(true);
    let scan = Arc::new(Notify::new());
    *deps.adapters.scan_gate.lock().unwrap() = Some(scan.clone());
    let surface = RecordingSurface::arc();
    let manager = Arc::new(ChatManager::new(deps.clone()).with_chat_surface(surface.clone()));
    (deps, manager, scan, surface)
}

async fn finish(manager: &ChatManager, scan: &Notify) {
    scan.notify_one();
    tokio::time::timeout(Duration::from_secs(2), manager.load_chat("c1"))
        .await
        .unwrap();
}

#[tokio::test]
async fn transcript_ready_returns_before_metadata_but_after_permission_and_resync_restoration() {
    let mut message = numbered_message(0);
    message.content = vec![
        serde_json::from_value(serde_json::json!({
            "type":"tool_use","id":"pending-call","name":"Bash","input":{"command":"pwd"}
        }))
        .unwrap(),
    ];
    let (deps, manager, scan, surface) = fixture(vec![message]);
    tokio::time::timeout(Duration::from_secs(1), manager.resume_transcript("c1"))
        .await
        .unwrap();
    deps.adapters.scan_started.notified().await;
    let snapshot = manager.get_resume_snapshot("c1").await;
    assert_eq!(snapshot.messages.len(), 1);
    assert_eq!(snapshot.pending.unwrap().tool_use_id, "pending-call");
    assert!(
        matches!(surface.events().as_slice(), [ChatSurfaceEvent::Resync { chat_id }] if chat_id == "c1")
    );
    assert!(manager.lifecycle.try_claim_offload("c1").is_none());
    finish(&manager, &scan).await;
}

#[tokio::test]
async fn concurrent_ready_requests_share_restoration_and_keep_the_cached_revisit() {
    let (deps, manager, scan, _) = fixture(vec![numbered_message(1)]);
    let requests = async {
        tokio::join!(
            manager.resume_transcript("c1"),
            manager.resume_transcript("c1")
        );
    };
    tokio::time::timeout(Duration::from_secs(1), requests)
        .await
        .unwrap();
    assert_eq!(deps.adapters.history_loads.load(Ordering::SeqCst), 1);
    finish(&manager, &scan).await;
    manager.resume_transcript("c1").await;
    assert_eq!(deps.adapters.history_loads.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn ready_requests_wait_for_history_instead_of_exposing_a_partial_snapshot() {
    let (deps, manager, scan, surface) = fixture(vec![]);
    let history_gate = Arc::new((Notify::new(), Notify::new()));
    deps.set_session_to_return(Arc::new(crate::test_support::FakeSession {
        history: vec![numbered_message(2)],
        history_gate: Some(history_gate.clone()),
        ..Default::default()
    }));
    let ready = tokio::spawn({
        let manager = manager.clone();
        async move { manager.resume_transcript("c1").await }
    });
    history_gate.0.notified().await;
    assert!(!ready.is_finished());
    assert!(surface.events().is_empty());
    history_gate.1.notify_one();
    tokio::time::timeout(Duration::from_secs(1), ready)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(manager.get_resume_snapshot("c1").await.messages[0].id, "h2");
    finish(&manager, &scan).await;
}

#[tokio::test]
async fn empty_transcripts_are_ready_without_waiting_for_metadata() {
    let (deps, manager, scan, _) = fixture(vec![]);
    tokio::time::timeout(Duration::from_secs(1), manager.resume_transcript("c1"))
        .await
        .unwrap();
    deps.adapters.scan_started.notified().await;
    let snapshot = tokio::time::timeout(Duration::from_secs(1), manager.get_resume_snapshot("c1"))
        .await
        .unwrap();
    assert!(snapshot.messages.is_empty());
    finish(&manager, &scan).await;
}

#[tokio::test]
async fn an_aborted_restoration_can_be_retried_instead_of_looking_ready() {
    let (deps, manager, scan, _) = fixture(vec![]);
    let history_gate = Arc::new((Notify::new(), Notify::new()));
    deps.set_session_to_return(Arc::new(crate::test_support::FakeSession {
        history: vec![numbered_message(3)],
        history_gate: Some(history_gate.clone()),
        history_loads: Some(deps.adapters.history_loads.clone()),
        ..Default::default()
    }));
    let loading = tokio::spawn({
        let manager = manager.clone();
        async move { manager.load_chat("c1").await }
    });
    history_gate.0.notified().await;
    loading.abort();
    assert!(loading.await.unwrap_err().is_cancelled());
    history_gate.1.notify_one();
    tokio::time::timeout(Duration::from_secs(1), manager.resume_transcript("c1"))
        .await
        .unwrap();
    assert_eq!(deps.adapters.history_loads.load(Ordering::SeqCst), 2);
    assert_eq!(manager.get_resume_snapshot("c1").await.messages[0].id, "h3");
    finish(&manager, &scan).await;
}

#[tokio::test]
async fn ending_a_chat_while_warming_does_not_reactivate_its_registry_cell() {
    let (deps, manager, scan, _) = fixture(vec![numbered_message(4)]);
    manager.resume_transcript("c1").await;
    deps.adapters.scan_started.notified().await;
    manager.end_chat("c1").await;
    scan.notify_one();
    for _ in 0..64 {
        tokio::task::yield_now().await;
    }
    assert!(!manager.shared.active_chats.contains_key("c1"));
    assert_eq!(deps.adapters.history_loads.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn closed_chats_still_publish_persisted_todos_on_transcript_resume() {
    for status in [ChatStatus::Ended, ChatStatus::Archived] {
        let mut chat = test_chat("c1");
        chat.status = status;
        chat.todos = Some(vec![
            serde_json::from_value(serde_json::json!({
                "content":"check history", "status":"pending", "activeForm":"checking history"
            }))
            .unwrap(),
        ]);
        let deps = FakeDeps::with_chats(vec![chat]);
        let manager = ChatManager::new(deps.clone());
        manager.resume_transcript("c1").await;
        for _ in 0..64 {
            tokio::task::yield_now().await;
        }
        assert!(deps.events().iter().any(|event| matches!(event,
            DaemonEvent::TodosUpdated { chat_id, todos } if chat_id == "c1" && todos.len() == 1)));
        assert!(deps.events().iter().any(|event| matches!(event,
            DaemonEvent::ChatUpdated { chat, .. } if chat.id == "c1" && chat.status == status)));
    }
}

#[tokio::test]
async fn a_waiting_transcript_resume_does_not_reload_a_chat_closed_during_restoration() {
    let (deps, manager, scan, _) = fixture(vec![]);
    let history_gate = Arc::new((Notify::new(), Notify::new()));
    deps.set_session_to_return(Arc::new(crate::test_support::FakeSession {
        history: vec![numbered_message(3)],
        history_gate: Some(history_gate.clone()),
        history_loads: Some(deps.adapters.history_loads.clone()),
        ..Default::default()
    }));
    let loading = tokio::spawn({
        let manager = manager.clone();
        async move { manager.load_chat("c1").await }
    });
    history_gate.0.notified().await;
    let mut waiting = Box::pin(manager.resume_transcript("c1"));
    assert!(
        tokio::time::timeout(Duration::from_millis(10), &mut waiting)
            .await
            .is_err()
    );
    manager.end_chat("c1").await;
    loading.abort();
    assert!(loading.await.unwrap_err().is_cancelled());
    history_gate.1.notify_one();
    scan.notify_one();
    tokio::time::timeout(Duration::from_secs(1), waiting)
        .await
        .unwrap();
    assert!(!manager.shared.active_chats.contains_key("c1"));
    assert_eq!(deps.adapters.history_loads.load(Ordering::SeqCst), 1);
}
