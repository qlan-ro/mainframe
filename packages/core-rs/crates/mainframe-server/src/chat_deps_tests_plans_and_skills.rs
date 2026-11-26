/// A URL first seen as `mentioned` is upgraded in place to `created` when
/// a later scan matches it to a pending create — never duplicated, never
/// downgraded.
#[test]
fn scan_and_persist_prs_upgrades_a_mentioned_pr_to_created_for_the_same_url() {
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

    let mentioned_only = vec![tool_result_msg(
        "m1",
        "tu-unrelated",
        "https://github.com/acme/repo/pull/7",
    )];
    deps.scan_and_persist_prs(&chat.id, &mentioned_only);
    let after_mention = rx.try_recv().expect("mention scan should emit");
    match after_mention {
        DaemonEvent::ChatPrDetected { pr, .. } => {
            assert_eq!(pr.source, DetectedPrSource::Mentioned);
        }
        other => panic!("unexpected event: {other:?}"),
    }

    let with_create = vec![
        tool_use_msg("m2", "tu1", "Bash", "gh pr create --title x"),
        tool_result_msg("m3", "tu1", "https://github.com/acme/repo/pull/7"),
    ];
    deps.scan_and_persist_prs(&chat.id, &with_create);

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
        }],
        "upgraded in place, not duplicated"
    );

    let after_create = rx.try_recv().expect("upgrade scan should emit");
    match after_create {
        DaemonEvent::ChatPrDetected { pr, .. } => {
            assert_eq!(pr.source, DetectedPrSource::Created);
        }
        other => panic!("unexpected event: {other:?}"),
    }
}

#[tokio::test]
async fn persist_plan_and_skill_files_writes_both_extracted_lists() {
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
    let session = mainframe_adapter_api::test_support::FakeSession {
        plan_paths: vec!["/repo/PLAN.md".to_string()],
        skill_paths: vec![SkillFileEntry {
            path: "/repo/.claude/skills/tdd/SKILL.md".to_string(),
            display_name: "tdd".to_string(),
        }],
        spawned: false,
        ..mainframe_adapter_api::test_support::FakeSession::spawned()
    };

    deps.persist_plan_and_skill_files(&chat.id, &session, None)
        .await;

    let plan_files = deps
        .db
        .call_blocking({
            let id = chat.id.clone();
            move |d| d.chats.get_plan_files(&id)
        })
        .unwrap();
    assert_eq!(plan_files, vec!["/repo/PLAN.md".to_string()]);

    let skill_files = deps
        .db
        .call_blocking({
            let id = chat.id.clone();
            move |d| d.chats.get_skill_files(&id)
        })
        .unwrap();
    assert_eq!(
        skill_files,
        vec![SkillFileEntry {
            path: "/repo/.claude/skills/tdd/SKILL.md".to_string(),
            display_name: "tdd".to_string(),
        }]
    );
}

#[tokio::test]
async fn scan_persists_the_current_skill_path_and_reuses_stable_metadata() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("session.jsonl");
    let skill = r#"{"type":"assistant","sessionId":"session","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"round3-example"}}]}}"#;
    std::fs::write(&source, skill).unwrap();
    let session = claude_scan_session(dir.path());
    session.load_history().await.unwrap();
    let mut collected = session.take_history_files().unwrap();
    collected.plans.push("/carried-only.md".into());
    let old = dir.path().join("old-skill.md");
    let current = dir.path().join(".claude/skills/round3-example/SKILL.md");
    std::fs::write(&old, "").unwrap();
    std::fs::create_dir_all(current.parent().unwrap()).unwrap();
    std::fs::rename(old, &current).unwrap();
    let deps = test_deps();
    let id = deps
        .db
        .call_blocking(|d| {
            let project = d.projects.create("/tmp/project", None)?;
            d.chats
                .create(&mainframe_types::chat::NewChat {
                    project_id: project.id,
                    adapter_id: "claude".into(),
                    ..Default::default()
                })
                .map(|chat| chat.id)
        })
        .unwrap();
    deps.persist_plan_and_skill_files(&id, session.as_ref(), Some(collected))
        .await;
    let (plans, skills) = deps
        .db
        .call_blocking(move |d| Ok((d.chats.get_plan_files(&id)?, d.chats.get_skill_files(&id)?)))
        .unwrap();
    assert_eq!(plans, ["/carried-only.md"]);
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].path, current.to_str().unwrap());
}

fn claude_scan_session(dir: &std::path::Path) -> Arc<dyn AdapterSession> {
    use mainframe_adapter_api::Adapter;
    mainframe_adapter_claude::adapter::ClaudeAdapter::default().create_session(SessionOptions {
        project_path: dir.to_str().unwrap().into(),
        chat_id: Some("session".into()),
        session_file_path: Some(dir.join("session.jsonl").to_str().unwrap().into()),
        mainframe_chat_id: "chat".into(),
        fork_source: None,
    })
}

#[tokio::test]
async fn scan_discovers_appended_primary_records_and_ignores_new_child_transcripts() {
    use std::io::Write;
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("session.jsonl");
    let plan = r#"{"type":"user","toolUseResult":{"plan":"done","filePath":"/late.md"}}"#;
    let skill = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"late"}}]}}"#;
    std::fs::write(&source, "{\"sessionId\":\"session\"}\n").unwrap();
    let session = claude_scan_session(dir.path());
    session.load_history().await.unwrap();
    let files = session.take_history_files().unwrap();
    assert!(files.plans.is_empty() && files.skill_names.is_empty());
    let mut writer = std::fs::OpenOptions::new()
        .append(true)
        .open(source)
        .unwrap();
    writeln!(writer, "{plan}\n{skill}").unwrap();
    let scanned = session.scan_history_files(Some(files)).await.unwrap();
    assert_eq!(scanned.plans, ["/late.md"]);
    assert_eq!(scanned.skills[0].display_name, "late");
    session.load_history().await.unwrap();
    let files = session.take_history_files();
    let children = dir.path().join("session/subagents");
    std::fs::create_dir_all(&children).unwrap();
    std::fs::write(
        children.join("agent-child.jsonl"),
        plan.replace("/late", "/child"),
    )
    .unwrap();
    assert_eq!(
        session.scan_history_files(files).await.unwrap().plans,
        ["/late.md"]
    );
}
