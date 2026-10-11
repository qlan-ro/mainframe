use super::*;

fn make_task() -> BackgroundTask {
    BackgroundTask {
        id: "b-1".to_string(),
        kind: BackgroundWorkKind::Bash,
        tool_name: BackgroundTaskToolName::Bash,
        tool_use_id: "tu-1".to_string(),
        command: "pnpm dev".to_string(),
        description: "dev server".to_string(),
        output_path: Some("/tmp/b-1.output".to_string()),
        started_at: 1000,
        ended_at: None,
        status: BackgroundTaskStatus::Running,
        last_output_line: None,
        summary: None,
        usage: None,
        recovered: None,
        workflow_name: None,
        run_id: None,
    }
}

#[test]
fn started_event_matches_fixture_shape() {
    // Mirrors packages/core-rs/crates/mainframe-types/tests/fixtures/event.background_task-started.json
    // (minus the `_provenance` tag).
    let json = r#"{"type":"background_task.started","chatId":"chat_9f2a3b1c","task":{"id":"bgt_001","kind":"bash","toolName":"Bash","toolUseId":"toolu_05E","command":"pnpm test --watch","description":"Run tests in watch mode","outputPath":null,"startedAt":1751970000000,"endedAt":null,"status":"running","lastOutputLine":null,"summary":null,"usage":null}}"#;
    let event: BackgroundTaskEvent = serde_json::from_str(json).unwrap();
    assert!(matches!(event, BackgroundTaskEvent::Started { .. }));
    assert_eq!(serde_json::to_string(&event).unwrap(), json);
}

#[test]
fn nullable_fields_serialize_null_not_omitted() {
    let task = BackgroundTask {
        id: "t".to_string(),
        kind: BackgroundWorkKind::Bash,
        tool_name: BackgroundTaskToolName::Monitor,
        tool_use_id: "u".to_string(),
        command: "c".to_string(),
        description: "d".to_string(),
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
    };
    let s = serde_json::to_string(&task).unwrap();
    assert!(s.contains(r#""outputPath":null"#));
    assert!(s.contains(r#""endedAt":null"#));
    assert!(s.contains(r#""usage":null"#));
    // `recovered`, `workflowName`, `runId` are the skip-when-absent fields.
    assert!(!s.contains("recovered"));
    assert!(!s.contains("workflowName"));
    assert!(!s.contains("runId"));
}

#[test]
fn recovered_true_round_trips() {
    let json = r#"{"id":"t","kind":"bash","toolName":"Bash","toolUseId":"u","command":"c","description":"d","outputPath":null,"startedAt":1,"endedAt":2,"status":"completed","lastOutputLine":"done","summary":"ok","usage":{"totalTokens":100,"toolUses":3,"durationMs":500},"recovered":true}"#;
    let task: BackgroundTask = serde_json::from_str(json).unwrap();
    assert_eq!(task.recovered, Some(true));
    assert_eq!(serde_json::to_string(&task).unwrap(), json);
}

#[test]
fn background_work_kind_accepts_four_kinds() {
    for (raw, kind) in [
        ("bash", BackgroundWorkKind::Bash),
        ("agent", BackgroundWorkKind::Agent),
        ("workflow", BackgroundWorkKind::Workflow),
        ("other", BackgroundWorkKind::Other),
    ] {
        let parsed: BackgroundWorkKind =
            serde_json::from_value(serde_json::Value::String(raw.to_string())).unwrap();
        assert_eq!(parsed, kind);
    }
}

#[test]
fn background_work_kind_rejects_unknown() {
    let res: Result<BackgroundWorkKind, _> =
        serde_json::from_value(serde_json::Value::String("local_bash".to_string()));
    assert!(res.is_err());
}

#[test]
fn to_activity_task_picks_fields() {
    assert_eq!(
        to_activity_task(&make_task()),
        BackgroundActivityTask {
            id: "b-1".to_string(),
            kind: BackgroundWorkKind::Bash,
            description: "dev server".to_string(),
            started_at: 1000,
            workflow_name: None,
            run_id: None,
        }
    );
}

#[test]
fn to_activity_task_falls_back_to_command() {
    let mut task = make_task();
    task.description = String::new();
    assert_eq!(
        to_activity_task(&task),
        BackgroundActivityTask {
            id: "b-1".to_string(),
            kind: BackgroundWorkKind::Bash,
            description: "pnpm dev".to_string(),
            started_at: 1000,
            workflow_name: None,
            run_id: None,
        }
    );
}

#[test]
fn to_activity_task_carries_workflow_link_through() {
    let mut task = make_task();
    task.kind = BackgroundWorkKind::Workflow;
    task.workflow_name = Some("deploy".to_string());
    task.run_id = Some("run_1".to_string());
    let activity = to_activity_task(&task);
    assert_eq!(activity.workflow_name, Some("deploy".to_string()));
    assert_eq!(activity.run_id, Some("run_1".to_string()));
}

#[test]
fn derive_background_activity_empty_is_none() {
    assert_eq!(derive_background_activity(&[]), None);
}

#[test]
fn derive_background_activity_counts_by_kind_and_totals() {
    let mk = |id: &str, kind: BackgroundWorkKind, description: &str| BackgroundActivityTask {
        id: id.to_string(),
        kind,
        description: description.to_string(),
        started_at: 1000,
        workflow_name: None,
        run_id: None,
    };
    let tasks = vec![
        mk("a-1", BackgroundWorkKind::Agent, "reviewer"),
        mk("a-2", BackgroundWorkKind::Agent, "tester"),
        mk("b-1", BackgroundWorkKind::Bash, "dev server"),
        mk("w-1", BackgroundWorkKind::Workflow, "deploy"),
    ];
    let activity = derive_background_activity(&tasks).unwrap();
    assert_eq!(activity.total, 4);
    assert_eq!(activity.by_kind.get(&BackgroundWorkKind::Agent), Some(&2));
    assert_eq!(activity.by_kind.get(&BackgroundWorkKind::Bash), Some(&1));
    assert_eq!(
        activity.by_kind.get(&BackgroundWorkKind::Workflow),
        Some(&1)
    );
    assert_eq!(activity.by_kind.len(), 3);
    assert_eq!(activity.tasks, tasks);
}

#[test]
fn derive_background_activity_json_round_trips() {
    // Stands in for the zod BackgroundActivitySchema validation in TS.
    let activity = derive_background_activity(&[to_activity_task(&make_task())]).unwrap();
    let json = serde_json::to_value(&activity).unwrap();
    let back: BackgroundActivity = serde_json::from_value(json).unwrap();
    assert_eq!(back, activity);
}
