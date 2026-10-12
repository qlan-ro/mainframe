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

    deps.persist_plan_and_skill_files(&chat.id, &session).await;

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
