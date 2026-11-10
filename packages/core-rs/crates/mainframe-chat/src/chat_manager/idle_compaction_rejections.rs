use super::idle_compaction_tests::{compactor, fixture};
use super::idle_test_session::{IdleTestSession, reanchor};
use super::*;
use mainframe_types::{compaction::CacheClassification, sync::LockExt as _};

#[tokio::test(flavor = "multi_thread")]
async fn idle_compaction_provider_rejections() {
    for reject in 0..5 {
        let mut session = IdleTestSession::new();
        match reject {
            0 => session.class = CacheClassification::Claude5m,
            1 => session.class = CacheClassification::Unknown,
            2 => session.supported = false,
            3 => session.inner.spawned = false,
            _ => session
                .ready
                .store(false, std::sync::atomic::Ordering::SeqCst),
        }
        let (manager, _, session) = fixture(session).await;
        compactor(&manager).evaluate("c").await;
        assert!(
            session.requests.lock_recover().is_empty(),
            "provider rejection {reject}"
        );
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn idle_compaction_permission_and_transcript_rejections() {
    let (manager, _, session) = fixture(IdleTestSession::new()).await;
    manager.shared.permissions.lock_recover().enqueue(
        "c",
        mainframe_types::adapter::ControlRequest {
            request_id: "gate".into(),
            tool_name: "Bash".into(),
            tool_use_id: "tool".into(),
            input: HashMap::new(),
            suggestions: Vec::new(),
            decision_reason: None,
            options: None,
        },
    );
    compactor(&manager).evaluate("c").await;
    assert!(session.requests.lock_recover().is_empty());
    manager.shared.permissions.lock_recover().clear("c");
    for node in [
        mainframe_types::chat::MessageContentNode::ToolUse {
            timing: None,
            command_execution: None,
            id: "tool".into(),
            name: "Task".into(),
            input: HashMap::new(),
            parent_tool_use_id: None,
        },
        mainframe_types::chat::MessageContentNode::Compaction {
            compaction: None,
            parent_tool_use_id: None,
        },
    ] {
        {
            let mut cache = manager.shared.messages.lock_recover();
            let message = cache.create_transient_message(
                "c",
                ChatMessageType::System,
                vec![MessageContent::Node(node)],
                None,
            );
            cache.set("c", vec![message]);
        }
        compactor(&manager).evaluate("c").await;
        assert!(session.requests.lock_recover().is_empty());
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn idle_compaction_durable_claim_rejects_recreated_live_session_and_new_run_rearms() {
    let (manager, deps, session) = fixture(IdleTestSession::new()).await;
    session.finish.notify_one();
    compactor(&manager).evaluate("c").await;
    let replacement = Arc::new(IdleTestSession::new());
    manager.shared.active("c").unwrap().lock_recover().session = Some(replacement.clone());
    manager.shared.messages.lock_recover().set(
        "c",
        vec![ChatMessage {
            id: "done".into(),
            chat_id: "c".into(),
            r#type: ChatMessageType::Assistant,
            content: vec![MessageContent::Leaf(LeafContent::Text {
                text: "Done".into(),
                parent_tool_use_id: None,
            })],
            timestamp: String::new(),
            metadata: None,
        }],
    );
    compactor(&manager).evaluate("c").await;
    assert!(replacement.requests.lock_recover().is_empty());
    deps.idle_run_begin("c", "new-run").unwrap();
    deps.idle_run_complete("c", "new-run", Some(now_ms() - 54 * 60_000))
        .unwrap();
    replacement.finish.notify_one();
    compactor(&manager).evaluate("c").await;
    assert_eq!(replacement.requests.lock_recover().len(), 1);
    assert_eq!(
        replacement.requests.lock_recover()[0].id,
        "idle-compact:c:new-run"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn idle_compaction_codex_legacy_boundary_correlates_before_queue_release() {
    let mut fake = IdleTestSession::new();
    fake.inner.adapter = Some("codex".into());
    fake.legacy = true;
    let native = ChatMessage {
        id: "canonical".into(),
        chat_id: "c".into(),
        r#type: ChatMessageType::System,
        timestamp: mainframe_types::time::now_iso8601(),
        metadata: None,
        content: vec![MessageContent::Node(
            mainframe_types::chat::MessageContentNode::Compaction {
                compaction: None,
                parent_tool_use_id: None,
            },
        )],
    };
    fake.inner.history = vec![native.clone()];
    let (manager, deps, session) = fixture(fake).await;
    reanchor(&deps, Some(now_ms() - 27 * 60_000));
    session.finish.notify_one();
    compactor(&manager).evaluate("c").await;
    let provenance = deps.idle_provenance("c").unwrap();
    assert_eq!(provenance[0].vendor_id.as_deref(), Some("canonical"));
    assert!(provenance[0].command_uuid.is_none());
    let reloaded = manager
        .shared
        .merge_idle_history("c", vec![native])
        .unwrap();
    assert_eq!(reloaded.len(), 1);
    assert_eq!(reloaded[0].id, "idle-compact:c:run");
}

#[tokio::test(flavor = "multi_thread")]
async fn idle_compaction_final_clock_checks_expiry_and_rollback() {
    let (manager, deps, session) = fixture(IdleTestSession::new()).await;
    reanchor(&deps, Some(10));
    for now in [9, 10 + 53 * 60_000, 10 + 60 * 60_000 + 1] {
        let mut c = compactor(&manager);
        c.now = Arc::new(move || now);
        c.evaluate("c").await;
        assert!(session.requests.lock_recover().is_empty());
    }
    let mut c = compactor(&manager);
    c.now = Arc::new(|| 10 + 60 * 60_000);
    session.finish.notify_one();
    c.evaluate("c").await;
    assert_eq!(session.requests.lock_recover().len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn idle_compaction_running_background_tasks_and_agents_block_dispatch() {
    use mainframe_types::background_task::*;
    let (manager, deps, session) = fixture(IdleTestSession::new()).await;
    for kind in [
        BackgroundWorkKind::Bash,
        BackgroundWorkKind::Agent,
        BackgroundWorkKind::Workflow,
        BackgroundWorkKind::Other,
    ] {
        *deps.emitter.live_tasks.lock_recover() = vec![BackgroundTask {
            id: "task".into(),
            kind,
            tool_name: BackgroundTaskToolName::Bash,
            tool_use_id: "tool".into(),
            command: "cmd".into(),
            description: "Running".into(),
            output_path: None,
            started_at: 1,
            ended_at: None,
            status: BackgroundTaskStatus::Running,
            last_output_line: None,
            summary: None,
            usage: None,
            recovered: None,
            workflow_name: None,
            run_id: None,
        }];
        compactor(&manager).evaluate("c").await;
        assert!(session.requests.lock_recover().is_empty());
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn idle_compaction_native_failure_releases_queued_user_input() {
    let mut fake = IdleTestSession::new();
    fake.fail = true;
    let (manager, deps, session) = fixture(fake).await;
    let worker = {
        let c = compactor(&manager);
        tokio::spawn(async move {
            c.evaluate("c").await;
        })
    };
    session.started.notified().await;
    manager
        .send_message("c", "after failure", None, None)
        .await
        .unwrap();
    assert!(session.sent.lock_recover().is_empty());
    session.finish.notify_one();
    worker.await.unwrap();
    manager.drain_maintenance_queue("c").await.unwrap();
    assert_eq!(session.sent.lock_recover()[0].0, "after failure");
    assert!(deps.idle_markers("c").unwrap().is_empty());
    assert!(deps.idle_queue_list("c").unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn idle_compaction_expiry_during_durable_claim_skips_provider_io() {
    let (manager, deps, session) = fixture(IdleTestSession::new()).await;
    reanchor(&deps, Some(10));
    let calls = std::sync::atomic::AtomicUsize::new(0);
    let mut c = compactor(&manager);
    c.now = Arc::new(move || {
        if calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0 {
            10 + 60 * 60_000
        } else {
            11 + 60 * 60_000
        }
    });
    c.evaluate("c").await;
    assert!(session.requests.lock_recover().is_empty());
    assert!(deps.idle_run_get("c").unwrap().unwrap().claim.is_some());
}

#[tokio::test(flavor = "multi_thread")]
async fn idle_compaction_disable_after_claim_prevents_provider_io() {
    use mainframe_types::settings_kv::SettingsKv;
    let (manager, deps, session) = fixture(IdleTestSession::new()).await;
    let weak = Arc::downgrade(&deps);
    *deps.store.idle_claim_hook.lock_recover() = Some(Arc::new(move || {
        let deps = weak.upgrade().unwrap();
        tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(deps.settings.set(
                "general",
                "idleCompaction.enabled",
                "false",
            ))
        })
        .unwrap();
    }));
    compactor(&manager).evaluate("c").await;
    assert!(session.requests.lock_recover().is_empty());
    assert!(deps.idle_run_get("c").unwrap().unwrap().claim.is_some());
}

#[tokio::test(flavor = "multi_thread")]
async fn idle_compaction_history_reload_waits_for_terminal_release() {
    let (manager, _, session) = fixture(IdleTestSession::new()).await;
    let worker = {
        let c = compactor(&manager);
        tokio::spawn(async move {
            c.evaluate("c").await;
        })
    };
    session.started.notified().await;
    let mut history = {
        let manager = manager.clone();
        tokio::spawn(async move { manager.lifecycle.claim_history("c").await.map(drop) })
    };
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(10), &mut history)
            .await
            .is_err()
    );
    session.finish.notify_one();
    worker.await.unwrap();
    assert!(history.await.unwrap().is_some());
}
