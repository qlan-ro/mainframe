#[tokio::test]
async fn no_worktree_last_user_releases_the_project_root_scope() {
    let chat = chat_over("c1", None, ChatStatus::Active);
    let deps = fake(chat, Vec::new());
    let mgr = manager(deps.clone());
    mgr.archive_chat("c1", false).await;

    assert_eq!(
        deps.workspace.stop_calls.lock().unwrap().as_slice(),
        &[("p1".to_string(), "/proj".to_string())]
    );
    assert_eq!(
        deps.workspace.tunnel_stop_calls.lock().unwrap().as_slice(),
        &[("p1".to_string(), "/proj".to_string())]
    );
    assert!(deps.emitter.events.lock().unwrap().iter().any(|e| matches!(
        e,
        DaemonEvent::LaunchScopeReleased { effective_path, .. } if effective_path == "/proj"
    )));
}

#[tokio::test]
async fn start_chat_emits_a_chat_scoped_error_when_the_project_directory_is_gone() {
    let chat = chat_over("c1", None, ChatStatus::Active);
    let deps = fake(chat, Vec::new());
    deps.paths.set_present_paths(&[]);
    let mgr = manager(deps.clone());

    mgr.start_chat("c1").await;

    let events = deps.emitter.events.lock().unwrap();
    assert!(events.iter().any(|event| matches!(
        event,
        DaemonEvent::Error { chat_id: Some(chat_id), error }
            if chat_id == "c1"
                && error.contains("Project directory does not exist or is not accessible")
                && error.contains("/proj")
    )));
    assert!(
        !events
            .iter()
            .any(|event| matches!(event, DaemonEvent::ProcessStarted { .. }))
    );
}

#[tokio::test]
async fn start_chat_emits_a_chat_scoped_error_when_the_worktree_is_gone() {
    let chat = chat_over("c1", Some("/wt/gone"), ChatStatus::Active);
    let deps = fake(chat, Vec::new());
    deps.paths.set_present_paths(&["/proj"]);
    let mgr = manager(deps.clone());

    mgr.start_chat("c1").await;

    let events = deps.emitter.events.lock().unwrap();
    assert!(events.iter().any(|event| matches!(
        event,
        DaemonEvent::Error { chat_id: Some(chat_id), error }
            if chat_id == "c1"
                && error.contains("Worktree directory does not exist")
                && error.contains("/wt/gone")
    )));
    assert!(
        !events
            .iter()
            .any(|event| matches!(event, DaemonEvent::ProcessStarted { .. }))
    );
}

#[tokio::test]
async fn start_chat_proceeds_when_the_worktree_is_live_and_the_project_path_is_gone() {
    let chat = chat_over("c1", Some("/wt/live"), ChatStatus::Active);
    let deps = fake(chat, Vec::new());
    deps.paths.set_present_paths(&["/wt/live"]);
    let mgr = manager(deps.clone());

    mgr.start_chat("c1").await;

    let events = deps.emitter.events.lock().unwrap();
    assert!(!events.iter().any(|event| matches!(
        event,
        DaemonEvent::Error { error, .. }
            if error.contains("Project directory does not exist or is not accessible")
                && error.contains("/proj")
    )));
}

// ── the no-persistence spawn decision ─────────────────────────────────────
#[tokio::test]
async fn temporary_and_capable_writes_the_ephemeral_flag_before_spawning() {
    let mut chat = chat_over("c1", None, ChatStatus::Active);
    chat.temporary = true;
    let deps = no_persistence_capable(chat, FakeSession::with_activity(false, None));
    let mgr = manager(deps.clone());

    mgr.start_chat("c1").await;

    assert_eq!(vendor_session_ephemeral_updates(&deps).as_slice(), &[true]);
}

#[tokio::test]
async fn not_temporary_never_writes_the_ephemeral_flag_even_when_capable() {
    let chat = chat_over("c1", None, ChatStatus::Active); // temporary: false (default)
    let deps = no_persistence_capable(chat, FakeSession::with_activity(false, None));
    let mgr = manager(deps.clone());

    mgr.start_chat("c1").await;

    assert_eq!(vendor_session_ephemeral_updates(&deps).as_slice(), &[false]);
}

#[tokio::test]
async fn temporary_without_the_capability_never_writes_the_ephemeral_flag() {
    let mut chat = chat_over("c1", None, ChatStatus::Active);
    chat.temporary = true;
    let deps = fake(chat, Vec::new());
    deps.set_session_to_return(FakeSession::with_activity(false, None));
    let mgr = manager(deps.clone());

    mgr.start_chat("c1").await;

    assert_eq!(vendor_session_ephemeral_updates(&deps).as_slice(), &[false]);
}

#[tokio::test]
async fn a_dead_ephemeral_resume_target_is_cleared_before_the_spawn_reads_it() {
    let mut chat = chat_over("c1", None, ChatStatus::Active);
    chat.temporary = true;
    chat.vendor_session_ephemeral = true;
    chat.vendor_session_id = Some("dead-sess".to_string());
    let deps = no_persistence_capable(chat, FakeSession::with_activity(false, None));
    let mgr = manager(deps.clone());

    mgr.start_chat("c1").await;

    assert_eq!(deps.store.mark_context_lost_calls.lock().unwrap().len(), 1);
    assert_eq!(
        deps.store.mark_context_lost_calls.lock().unwrap()[0].0,
        "c1"
    );
    // The dead id must never reach `create_session` as a resume target.
    let calls = deps.adapters.created_sessions.lock().unwrap();
    assert!(calls.iter().all(|o| o.chat_id.is_none()));
}

#[tokio::test]
async fn a_non_project_chat_ensures_its_scratch_directory_on_every_start() {
    let mut chat = chat_over("c1", None, ChatStatus::Active);
    chat.scratch_path = Some("/data/scratch/c1".to_string());
    let deps = fake(chat, Vec::new());
    deps.set_session_to_return(FakeSession::with_activity(false, None));
    let mgr = manager(deps.clone());

    mgr.start_chat("c1").await;

    assert_eq!(
        deps.paths.ensure_dir_calls.lock().unwrap().as_slice(),
        &["/data/scratch/c1".to_string()]
    );
    // Its cwd is the scratch path, not the (unrelated) project path.
    assert_eq!(
        deps.adapters.created_sessions.lock().unwrap()[0].project_path,
        "/data/scratch/c1"
    );
}

#[tokio::test]
async fn a_project_chat_never_calls_ensure_dir() {
    let chat = chat_over("c1", None, ChatStatus::Active);
    let deps = fake(chat, Vec::new());
    deps.set_session_to_return(FakeSession::with_activity(false, None));
    let mgr = manager(deps.clone());

    mgr.start_chat("c1").await;

    assert!(deps.paths.ensure_dir_calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn default_model_for_uses_only_explicit_provider_settings() {
    let deps = fake(chat_over("c1", None, ChatStatus::Active), Vec::new());
    let mgr = manager(deps.clone());
    for (saved, expected) in [
        (Some("custom-model"), Some("custom-model")),
        (Some("default"), None),
        (Some(""), None),
        (None, None),
    ] {
        set_saved_default_model(&deps, "codex", saved).await;
        assert_eq!(mgr.default_model_for("codex").await.as_deref(), expected);
    }
}

fn pending_fork() -> PendingForkState {
    PendingForkState {
        fork_source: mainframe_types::adapter::ForkSource {
            source_session_id: "parent-session".to_string(),
            resume_path: Some("/tmp/fork-snapshots/n1/parent-session.jsonl".to_string()),
            last_turn_id: None,
        },
        snapshot_dir: "/tmp/fork-snapshots/n1".to_string(),
        provisional_title: "Untitled (fork)".to_string(),
    }
}

#[tokio::test]
async fn do_load_chat_resumes_an_unsent_fork_from_its_pending_fork_source() {
    let chat = chat_over("fork-1", None, ChatStatus::Active);
    let deps = fake(chat, Vec::new());
    deps.set_pending_fork("fork-1", pending_fork());
    deps.set_session_to_return(FakeSession::with_activity(false, None));
    let mgr = manager(deps.clone());

    mgr.load_chat("fork-1").await;

    let calls = deps.adapters.created_sessions.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].chat_id, None);
    assert_eq!(calls[0].fork_source, Some(pending_fork().fork_source));
}

/// A chat with neither its own session nor a pending fork still bails out
/// before ever calling `create_session` — the pre-existing behavior for
/// every non-fork chat with no session yet.
#[tokio::test]
async fn do_load_chat_skips_session_creation_with_no_session_and_no_pending_fork() {
    let chat = chat_over("c1", None, ChatStatus::Active);
    let deps = fake(chat, Vec::new());
    let mgr = manager(deps.clone());

    mgr.load_chat("c1").await;

    assert!(deps.adapters.created_sessions.lock().unwrap().is_empty());
}

#[tokio::test]
async fn do_start_chat_passes_the_pending_fork_source_to_the_spawn_session() {
    let chat = chat_over("fork-1", None, ChatStatus::Active);
    let deps = fake(chat, Vec::new());
    deps.set_pending_fork("fork-1", pending_fork());
    // Not spawned, so `start_chat` proceeds past `do_load_chat`'s session to
    // build (and record the options for) a fresh spawn session.
    deps.set_session_to_return(FakeSession::with_activity(false, None));
    let mgr = manager(deps.clone());

    mgr.start_chat("fork-1").await;

    let calls = deps.adapters.created_sessions.lock().unwrap();
    let last = calls.last().expect("start_chat builds a spawn session");
    assert_eq!(last.chat_id, None);
    assert_eq!(last.fork_source, Some(pending_fork().fork_source));
}
