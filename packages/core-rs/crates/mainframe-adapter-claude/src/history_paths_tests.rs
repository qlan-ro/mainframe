use super::*;
use serde_json::json;

#[tokio::test]
async fn metadata_scans_preserve_plans_and_skills_around_large_image_results() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("session.jsonl");
    let entries = [
        json!({"type":"user","message":{"content":[{"type":"tool_result",
            "content":[{"type":"image","source":{"data":"A".repeat(2_000_000)}}]}]}}),
        json!({"type":"user","toolUseResult":{"plan":"the plan","filePath":"plans/p.md"}}),
        json!({"type":"assistant","message":{"content":[{"type":"tool_use",
            "name":"Skill","input":{"skill":"tdd"}}]}}),
        json!({"type":"user","toolUseResult":{"plan":false,"filePath":"ignored.md"}}),
    ];
    std::fs::write(
        &path,
        entries
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n"),
    )
    .unwrap();
    let discovered = DiscoveredFiles {
        complete: true,
        primary_path: path.to_string_lossy().into_owned(),
        all_files: vec![path.to_string_lossy().into_owned()],
        subagent_files: HashSet::new(),
    };
    assert_eq!(
        plan_file_paths_from(&discovered, "/project").await.unwrap(),
        vec!["/project/plans/p.md"]
    );
    let skills = skill_file_paths_from(&discovered, "/project")
        .await
        .unwrap();
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].display_name, "tdd");
    assert_metadata_matches(&discovered).await;
}

async fn assert_metadata_matches(discovered: &DiscoveredFiles) {
    let plans = plan_file_paths_from(discovered, "/plans").await.unwrap();
    let skills = skill_file_paths_from(discovered, "/project").await.unwrap();
    for messages in [true, false] {
        let (_, files) = load_discovered_history("session", discovered, "/plans", messages)
            .await
            .unwrap();
        assert_eq!(files.plans, plans);
        assert_eq!(
            files.skill_names,
            skills
                .iter()
                .map(|s| s.display_name.clone())
                .collect::<Vec<_>>()
        );
    }
}

#[tokio::test]
async fn metadata_matches_both_scans_on_claude_fixtures() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/__fixtures__");
    let mut files: Vec<_> = std::fs::read_dir(root)
        .unwrap()
        .map(Result::unwrap)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "jsonl"))
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    files.push(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../mainframe-server/tests/fixtures/golden-session-with-tool-calls.jsonl")
            .to_string_lossy()
            .into_owned(),
    );
    assert_metadata_matches(&DiscoveredFiles {
        complete: true,
        primary_path: String::new(),
        all_files: files,
        subagent_files: HashSet::default(),
    })
    .await;
}

#[tokio::test]
async fn failed_history_worker_returns_an_adapter_error() {
    let result = crate::history::run_history_worker(|| panic!("synthetic worker failure")).await;
    assert!(matches!(
        result,
        Err(mainframe_adapter_api::AdapterError::Unavailable(_))
    ));
}
