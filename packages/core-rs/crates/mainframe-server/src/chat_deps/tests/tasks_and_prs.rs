
#[test]
fn tracker_end_all_running_delegates_to_the_background_task_tracker() {
    let deps = test_deps();
    deps.background_tasks.start(
        "c-live",
        TaskSeed {
            id: "a-1".to_string(),
            kind: BackgroundWorkKind::Agent,
            tool_name: BackgroundTaskToolName::Monitor,
            tool_use_id: "tu-a-1".to_string(),
            command: "cmd".to_string(),
            description: "reviewer".to_string(),
            workflow_name: None,
        },
        "/tmp/mf-273-a-1.log".to_string(),
    );
    assert_eq!(deps.background_tasks.list_live("c-live").len(), 1);

    deps.tracker_end_all_running("c-live");

    assert!(deps.background_tasks.list_live("c-live").is_empty());
}

#[test]
fn workflow_runs_stop_all_delegates_to_the_workflow_store() {
    let deps = test_deps();
    deps.claude_workflows
        .seed("c-live", "task-1", Some("todo-lane".to_string()));
    deps.claude_workflows.apply_progress(
        "c-live",
        "task-1",
        ProgressUsage {
            total_tokens: 10,
            duration_ms: 500,
        },
        Some(&[serde_json::json!({
            "type": "workflow_phase",
            "index": 0,
            "title": "Plan"
        })]),
    );

    deps.workflow_runs_stop_all("c-live");

    let runs = deps.claude_workflows.runs_for_chat("c-live");
    let run = runs.iter().find(|r| r.task_id == "task-1").unwrap();
    assert_eq!(run.status, ClaudeWorkflowRunStatus::Stopped);
    assert_eq!(
        run.phases.len(),
        1,
        "AC 24: the snapshot must survive the stop"
    );
}

#[test]
fn scan_and_persist_prs_persists_a_new_pr_and_emits_chat_pr_detected() {
    let deps = test_deps();
    let project = deps
        .db
        .call_blocking(|d| d.projects.create("/tmp/p1", None))
        .unwrap();
    let chat = deps
        .db
        .call_blocking(move |d| {
            d.chats.create(&mainframe_types::chat::NewChat {
                project_id: project.id.clone(),
                adapter_id: "claude".to_string(),
                ..Default::default()
            })
        })
        .unwrap();
    let mut rx = deps.broadcast.subscribe();

    let history = vec![tool_result_msg(
        "m1",
        "tu1",
        "https://github.com/acme/repo/pull/42",
    )];
    deps.scan_and_persist_prs(&chat.id, &history);

    let persisted = deps
        .db
        .call_blocking({
            let id = chat.id.clone();
            move |d| d.chats.get_detected_prs(&id)
        })
        .unwrap();
    assert_eq!(
        persisted,
        vec![DetectedPr {
            url: "https://github.com/acme/repo/pull/42".to_string(),
            owner: "acme".to_string(),
            repo: "repo".to_string(),
            number: 42,
            source: DetectedPrSource::Mentioned,
        }]
    );

    let event = rx.try_recv().expect("chat.prDetected should be emitted");
    match event {
        DaemonEvent::ChatPrDetected { chat_id, pr } => {
            assert_eq!(chat_id, chat.id);
            assert_eq!(pr.number, 42);
        }
        other => panic!("unexpected event: {other:?}"),
    }
}

/// Codex's canonical shape for a PR-create turn: an assistant `Bash`
/// tool_use whose command is `gh pr create …`, followed by a `ToolResult`
/// carrying the PR URL — the same pair `load_scan_records` reconstructs
/// from the rollout.
#[test]
fn scan_and_persist_prs_persists_a_codex_shaped_create_as_created_and_emits_event() {
    let deps = test_deps();
    let project = deps
        .db
        .call_blocking(|d| d.projects.create("/tmp/p1", None))
        .unwrap();
    let chat = deps
        .db
        .call_blocking(move |d| {
            d.chats.create(&mainframe_types::chat::NewChat {
                project_id: project.id.clone(),
                adapter_id: "codex".to_string(),
                ..Default::default()
            })
        })
        .unwrap();
    let mut rx = deps.broadcast.subscribe();

    let history = vec![
        tool_use_msg("m1", "tu1", "Bash", "gh pr create --title x"),
        tool_result_msg("m2", "tu1", "https://github.com/acme/repo/pull/7"),
    ];
    deps.scan_and_persist_prs(&chat.id, &history);

    let persisted = deps
        .db
        .call_blocking({
            let id = chat.id.clone();
            move |d| d.chats.get_detected_prs(&id)
        })
        .unwrap();
    assert_eq!(
        persisted,
        vec![DetectedPr {
            url: "https://github.com/acme/repo/pull/7".to_string(),
            owner: "acme".to_string(),
            repo: "repo".to_string(),
            number: 7,
            source: DetectedPrSource::Created,
        }]
    );

    let event = rx.try_recv().expect("chat.prDetected should be emitted");
    match event {
        DaemonEvent::ChatPrDetected { chat_id, pr } => {
            assert_eq!(chat_id, chat.id);
            assert_eq!(pr.source, DetectedPrSource::Created);
        }
        other => panic!("unexpected event: {other:?}"),
    }
}

/// No duplicates: rescanning the same transcript a second time must not
/// add a second row or emit a second event — `add_detected_prs` dedupes by
/// URL.
#[test]
fn scan_and_persist_prs_run_twice_persists_no_duplicate_and_emits_no_second_event() {
    let deps = test_deps();
    let project = deps
        .db
        .call_blocking(|d| d.projects.create("/tmp/p1", None))
        .unwrap();
    let chat = deps
        .db
        .call_blocking(move |d| {
            d.chats.create(&mainframe_types::chat::NewChat {
                project_id: project.id.clone(),
                adapter_id: "codex".to_string(),
                ..Default::default()
            })
        })
        .unwrap();
    let mut rx = deps.broadcast.subscribe();

    let history = vec![
        tool_use_msg("m1", "tu1", "Bash", "gh pr create --title x"),
        tool_result_msg("m2", "tu1", "https://github.com/acme/repo/pull/7"),
    ];
    deps.scan_and_persist_prs(&chat.id, &history);
    rx.try_recv().expect("first scan should emit");

    deps.scan_and_persist_prs(&chat.id, &history);

    let persisted = deps
        .db
        .call_blocking({
            let id = chat.id.clone();
            move |d| d.chats.get_detected_prs(&id)
        })
        .unwrap();
    assert_eq!(persisted.len(), 1, "no duplicate row on rescan");
    assert!(
        rx.try_recv().is_err(),
        "no second chat.prDetected on rescan"
    );
}
