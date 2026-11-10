use super::idle_test_session::{IdleTestSession, reanchor};
use super::*;
use crate::test_support::{FakeDeps, test_chat};
use mainframe_adapter_api::idle_compaction::CompactionTiming;
use mainframe_types::{settings_kv::SettingsKv, sync::LockExt as _};

pub(super) async fn fixture(
    session: IdleTestSession,
) -> (Arc<ChatManager>, Arc<FakeDeps>, Arc<IdleTestSession>) {
    let mut chat = test_chat("c");
    chat.adapter_id = session.adapter_id().to_owned();
    chat.process_state = Some(Some(ProcessState::Idle));
    chat.last_context_total_tokens = Some(20_000);
    chat.title = Some("Existing title".into());
    let deps = FakeDeps::with_chats(vec![chat.clone()]);
    let adapter_id = chat.adapter_id.clone();
    let db = mainframe_db::actor::SqliteActor::spawn(move || {
        let d = mainframe_db::DatabaseManager::open(std::path::Path::new(":memory:"))?;
        d.connection().execute("INSERT INTO projects(id,name,path,created_at,last_opened_at) VALUES ('p1','p','/p','','')", [])?;
        d.connection().execute("INSERT INTO chats(id,project_id,adapter_id,status,created_at,updated_at) VALUES ('c','p1',?1,'active','','')", [&adapter_id])?;
        Ok(d)
    }).unwrap();
    assert!(deps.store.idle_db.set(db).is_ok());
    deps.settings
        .set("general", "idleCompaction.enabled", "true")
        .await
        .unwrap();
    deps.idle_run_begin("c", "run").unwrap();
    deps.idle_run_complete("c", "run", Some(now_ms() - 54 * 60_000))
        .unwrap();
    let manager = Arc::new(ChatManager::new(deps.clone()));
    manager.dispose();
    let session = Arc::new(session);
    let sink = manager
        .event_handler
        .build_sink("c", Some(session.id().to_owned()));
    *session.sink.lock_recover() = Some(sink);
    let mut active = ActiveChat::new(chat, Some(session.clone()));
    active.last_used_at = 10;
    manager
        .shared
        .active_chats
        .insert("c".into(), Arc::new(Mutex::new(active)));
    let mut messages = manager.shared.messages.lock_recover();
    let msg = messages.create_transient_message(
        "c",
        ChatMessageType::Assistant,
        vec![MessageContent::Leaf(LeafContent::Text {
            text: "Done".into(),
            parent_tool_use_id: None,
        })],
        None,
    );
    messages.append("c", msg);
    drop(messages);
    (manager, deps, session)
}

pub(super) fn compactor(manager: &ChatManager) -> crate::idle_compaction::IdleCompactor {
    crate::idle_compaction::IdleCompactor {
        shared: manager.shared.clone(),
        lifecycle: manager.lifecycle.clone(),
        timing_override: None,
        now: Arc::new(mainframe_types::time::now_ms),
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn idle_compaction_concurrent_sweeps_dispatch_once_without_activity() {
    let (manager, deps, session) = fixture(IdleTestSession::new()).await;
    let worker = {
        let c = compactor(&manager);
        tokio::spawn(async move {
            c.evaluate("c").await;
        })
    };
    session.started.notified().await;
    assert!(manager.lifecycle.try_claim_offload("c").is_none());
    compactor(&manager).evaluate("c").await;
    assert_eq!(session.requests.lock_recover().len(), 1);
    session.finish.notify_one();
    worker.await.unwrap();
    compactor(&manager).evaluate("c").await;
    assert_eq!(session.requests.lock_recover().len(), 1);
    assert_eq!(
        manager
            .shared
            .active("c")
            .unwrap()
            .lock_recover()
            .last_used_at,
        10
    );
    assert_eq!(session.last_activity_at(), Some(100));
    assert!(deps.events().is_empty());
    let markers = deps.idle_markers("c").unwrap();
    assert_eq!(markers.len(), 1);
    let reloaded = manager.shared.merge_idle_history("c", Vec::new()).unwrap();
    assert_eq!(reloaded, markers);
    assert_eq!(deps.idle_run_get("c").unwrap().unwrap().generation, "run");
}

#[tokio::test(flavor = "multi_thread")]
async fn idle_compaction_failure_never_retries_or_adds_row() {
    let mut fake = IdleTestSession::new();
    fake.fail = true;
    let (manager, deps, session) = fixture(fake).await;
    session.finish.notify_one();
    compactor(&manager).evaluate("c").await;
    compactor(&manager).evaluate("c").await;
    assert_eq!(session.requests.lock_recover().len(), 1);
    assert!(deps.idle_markers("c").unwrap().is_empty());
    assert!(deps.events().is_empty());
    assert!(manager.lifecycle.try_claim_offload("c").is_some());
}

#[tokio::test(flavor = "multi_thread")]
async fn idle_compaction_disabled_and_unknown_completion_fail_closed() {
    let (manager, deps, session) = fixture(IdleTestSession::new()).await;
    deps.settings
        .set("general", "idleCompaction.enabled", "false")
        .await
        .unwrap();
    compactor(&manager).evaluate("c").await;
    deps.settings
        .set("general", "idleCompaction.enabled", "true")
        .await
        .unwrap();
    reanchor(&deps, None);
    compactor(&manager).evaluate("c").await;
    assert!(session.requests.lock_recover().is_empty());
    assert!(deps.idle_run_get("c").unwrap().unwrap().claim.is_none());
}

#[tokio::test(flavor = "multi_thread")]
async fn idle_compaction_each_eligibility_rejection() {
    let (manager, _, session) = fixture(IdleTestSession::new()).await;
    let cell = manager.shared.active("c").unwrap();
    let baseline = cell.lock_recover().clone();
    for reject in 0..13 {
        {
            let mut active = cell.lock_recover();
            *active = baseline.clone();
            match reject {
                0 => active.chat.last_context_total_tokens = None,
                1 => active.chat.last_context_total_tokens = Some(19_999),
                2 => active.chat.status = ChatStatus::Archived,
                3 => active.chat.parent_chat_id = Some(Some("parent".into())),
                4 => active.chat.orchestration.created_by_chat_id = Some("parent".into()),
                5 => active.chat.process_state = Some(Some(ProcessState::Working)),
                6 => active.running_since_ms = Some(1),
                7 => active.turn_started_at = Some(1),
                8 => active.session = None,
                9 => active.chat.orchestration.active_child_ids = vec!["child".into()],
                10 => active.chat.orchestration.has_running_delegated_task = true,
                11 => active.chat.adapter_id = "acp".into(),
                _ => active.chat.process_state = None,
            }
        }
        compactor(&manager).evaluate("c").await;
        assert!(
            session.requests.lock_recover().is_empty(),
            "rejection {reject}"
        );
    }
    *cell.lock_recover() = baseline;
    let mut c = compactor(&manager);
    c.timing_override = Some(CompactionTiming::for_ttl(1));
    c.evaluate("c").await;
    assert!(session.requests.lock_recover().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn idle_compaction_user_send_wins_guard() {
    let (manager, _, session) = fixture(IdleTestSession::new()).await;
    let _send = manager.lifecycle.begin_send("c").await;
    compactor(&manager).evaluate("c").await;
    assert!(session.requests.lock_recover().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn idle_compaction_fifo_edit_cancel_and_terminal_release() {
    let (manager, deps, session) = fixture(IdleTestSession::new()).await;
    let worker = {
        let c = compactor(&manager);
        tokio::spawn(async move {
            c.evaluate("c").await;
        })
    };
    session.started.notified().await;
    assert_eq!(deps.idle_markers("c").unwrap().len(), 1);
    assert!(manager.shared.maintenance.active("c"));
    let queue = enqueue_and_edit(&manager, &deps, &session).await;
    let last_activity = manager
        .shared
        .active("c")
        .unwrap()
        .lock_recover()
        .last_used_at;
    session.finish.notify_one();
    worker.await.unwrap();
    manager.drain_maintenance_queue("c").await.unwrap();
    let sent = session.sent.lock_recover();
    assert_eq!(
        sent.iter().map(|s| s.0.as_str()).collect::<Vec<_>>(),
        vec!["first", "edited"]
    );
    assert_eq!(sent[0].1.as_deref(), Some(queue[0].uuid.as_str()));
    assert_eq!(sent[1].1.as_deref(), Some(queue[1].uuid.as_str()));
    assert!(deps.idle_queue_list("c").unwrap().is_empty());
    assert!(
        manager
            .shared
            .active("c")
            .unwrap()
            .lock_recover()
            .last_used_at
            >= last_activity
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn idle_compaction_timeout_readiness_blocks_delivery() {
    let (manager, deps, session) = fixture(IdleTestSession::new()).await;
    session
        .ready
        .store(false, std::sync::atomic::Ordering::SeqCst);
    manager.send_message("c", "wait", None, None).await.unwrap();
    assert_eq!(deps.idle_queue_list("c").unwrap().len(), 1);
    assert!(session.sent.lock_recover().is_empty());
    session
        .ready
        .store(true, std::sync::atomic::Ordering::SeqCst);
    manager.drain_maintenance_queue("c").await.unwrap();
    assert_eq!(session.sent.lock_recover().len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn idle_compaction_persistence_error_sends_nothing() {
    let (manager, deps, session) = fixture(IdleTestSession::new()).await;
    deps.store
        .idle_db
        .get()
        .unwrap()
        .call_blocking(|d| {
            d.connection()
                .execute("DROP TABLE idle_compaction_commands", [])?;
            Ok(())
        })
        .unwrap();
    compactor(&manager).evaluate("c").await;
    assert!(session.requests.lock_recover().is_empty());
    assert!(deps.idle_run_get("c").unwrap().unwrap().claim.is_none());
}

async fn enqueue_and_edit(
    manager: &ChatManager,
    deps: &FakeDeps,
    session: &IdleTestSession,
) -> Vec<mainframe_db::idle_compaction_queue::QueuedInput> {
    manager
        .send_message("c", "first", None, None)
        .await
        .unwrap();
    manager
        .send_message("c", "second", None, None)
        .await
        .unwrap();
    manager
        .send_message("c", "cancel me", None, None)
        .await
        .unwrap();
    let queue = deps.idle_queue_list("c").unwrap();
    assert_eq!(queue.len(), 3);
    manager
        .edit_queued_message("c", &queue[1].message.id, "edited")
        .await
        .unwrap();
    manager
        .cancel_queued_message("c", &queue[2].message.id)
        .await
        .unwrap();
    assert!(session.sent.lock_recover().is_empty());
    assert_eq!(
        manager
            .shared
            .active("c")
            .unwrap()
            .lock_recover()
            .chat
            .process_state,
        Some(Some(ProcessState::Idle))
    );
    queue
}
