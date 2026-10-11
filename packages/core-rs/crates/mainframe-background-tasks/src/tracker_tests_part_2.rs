#[test]
fn adopt_replaces_an_existing_entry() {
    let tracker = BackgroundTaskTracker::new();
    tracker.adopt(
        "chat-a",
        recovered_task("rec-1", "/p1", 1, BackgroundTaskStatus::Running),
        AdoptOptions::default(),
    );
    let mut replacement = recovered_task("rec-1", "/p2", 2, BackgroundTaskStatus::Stopped);
    replacement.ended_at = Some(3);
    replacement.summary = Some("gone".to_string());
    tracker.adopt("chat-a", replacement, AdoptOptions::default());
    assert_eq!(
        tracker
            .get("chat-a", "rec-1")
            .unwrap()
            .output_path
            .as_deref(),
        Some("/p2")
    );
    assert_eq!(
        tracker.get("chat-a", "rec-1").unwrap().status,
        BackgroundTaskStatus::Stopped
    );
}

fn plain_seed(id: &str) -> TaskSeed {
    TaskSeed {
        id: id.to_string(),
        kind: BackgroundWorkKind::Bash,
        tool_name: BackgroundTaskToolName::Bash,
        tool_use_id: "u".to_string(),
        command: "x".to_string(),
        description: String::new(),
        workflow_name: None,
    }
}

#[test]
fn list_all_running_returns_every_running_task_with_chat_id() {
    let tracker = BackgroundTaskTracker::new();
    tracker.start("chat-a", plain_seed("t1"), "/p/a-t1".to_string());
    tracker.start("chat-a", plain_seed("t2"), "/p/a-t2".to_string());
    tracker.start("chat-b", plain_seed("t1"), "/p/b-t1".to_string());
    tracker.end(
        "chat-a",
        "t2",
        TerminalUpdate {
            status: BackgroundTaskStatus::Completed,
            output_path: "/p/a-t2".to_string(),
            summary: String::new(),
            usage: None,
        },
    );
    let mut all: Vec<String> = tracker
        .list_all_running()
        .into_iter()
        .map(|(chat_id, task)| format!("{chat_id}/{}", task.id))
        .collect();
    all.sort();
    assert_eq!(all, vec!["chat-a/t1", "chat-b/t1"]);
}

#[test]
fn pid_map_stores_and_reads_per_chat_task() {
    let tracker = BackgroundTaskTracker::new();
    tracker.start("chat-a", plain_seed("t1"), "/p/t1.out".to_string());
    tracker.start("chat-b", plain_seed("t1"), "/p/t1.out".to_string());
    tracker.set_pid("chat-a", "t1", 111);
    tracker.set_pid("chat-b", "t1", 222);
    assert_eq!(tracker.get_pid("chat-a", "t1"), Some(111));
    assert_eq!(tracker.get_pid("chat-b", "t1"), Some(222));
    assert_eq!(tracker.get_pid("chat-a", "missing"), None);
}

#[test]
fn remove_chat_clears_the_pid_map_slice() {
    let tracker = BackgroundTaskTracker::new();
    tracker.start("chat-a", plain_seed("t1"), "/p/t1.out".to_string());
    tracker.set_pid("chat-a", "t1", 111);
    tracker.remove_chat("chat-a");
    assert_eq!(tracker.get_pid("chat-a", "t1"), None);
}

#[test]
fn stamps_the_kind_from_the_start_seed() {
    let tracker = BackgroundTaskTracker::new();
    tracker.start(
        "chat-a",
        seed_with("a-1", BackgroundWorkKind::Agent, "dev server"),
        "/tmp/a-1.output".to_string(),
    );
    assert_eq!(
        tracker.get("chat-a", "a-1").unwrap().kind,
        BackgroundWorkKind::Agent
    );
}

#[test]
fn list_live_returns_only_running_tasks_for_the_chat() {
    let tracker = BackgroundTaskTracker::new();
    tracker.start("chat-a", make_seed("t1"), "/p/t1".to_string());
    tracker.start(
        "chat-a",
        seed_with("t2", BackgroundWorkKind::Agent, "dev server"),
        "/p/t2".to_string(),
    );
    tracker.start("chat-b", make_seed("t3"), "/p/t3".to_string());
    tracker.end(
        "chat-a",
        "t1",
        TerminalUpdate {
            status: BackgroundTaskStatus::Completed,
            output_path: "/p/t1".to_string(),
            summary: String::new(),
            usage: None,
        },
    );
    assert_eq!(
        tracker
            .list_live("chat-a")
            .into_iter()
            .map(|t| t.id)
            .collect::<Vec<_>>(),
        vec!["t2"]
    );
    assert_eq!(
        tracker
            .list_live("chat-b")
            .into_iter()
            .map(|t| t.id)
            .collect::<Vec<_>>(),
        vec!["t3"]
    );
    assert!(tracker.list_live("chat-none").is_empty());
}

#[test]
fn upsert_on_duplicate_start_no_double_count_keeps_started_at_emits_updated() {
    let tracker = BackgroundTaskTracker::new();
    let mut rx = tracker.subscribe();
    tracker.start(
        "chat-a",
        seed_with("dup", BackgroundWorkKind::Bash, "first"),
        "/p/dup".to_string(),
    );
    let started_at = tracker.get("chat-a", "dup").unwrap().started_at;
    drain(&mut rx); // clear the started event

    tracker.start(
        "chat-a",
        seed_with("dup", BackgroundWorkKind::Bash, "second"),
        "/p/dup-again".to_string(),
    );

    assert_eq!(tracker.list_live("chat-a").len(), 1);
    let task = tracker.get("chat-a", "dup").unwrap();
    assert_eq!(task.started_at, started_at);
    assert_eq!(task.description, "second");
    assert_eq!(
        drain(&mut rx).iter().map(event_kind).collect::<Vec<_>>(),
        vec!["updated"]
    );
}

#[test]
fn re_registers_fresh_emits_started_when_previous_entry_is_terminal() {
    let tracker = BackgroundTaskTracker::new();
    let mut rx = tracker.subscribe();
    tracker.start("chat-a", make_seed("reuse"), "/p/reuse".to_string());
    tracker.end(
        "chat-a",
        "reuse",
        TerminalUpdate {
            status: BackgroundTaskStatus::Stopped,
            output_path: String::new(),
            summary: "CLI exited".to_string(),
            usage: None,
        },
    );
    drain(&mut rx);

    tracker.start("chat-a", make_seed("reuse"), "/p/reuse".to_string());

    assert_eq!(
        tracker.get("chat-a", "reuse").unwrap().status,
        BackgroundTaskStatus::Running
    );
    assert_eq!(
        drain(&mut rx).iter().map(event_kind).collect::<Vec<_>>(),
        vec!["started"]
    );
}

#[test]
fn end_all_running_stops_every_running_task_emits_ended_and_skips_terminal() {
    let tracker = BackgroundTaskTracker::new();
    let mut rx = tracker.subscribe();
    tracker.start("chat-a", make_seed("r1"), "/p/r1".to_string());
    tracker.start(
        "chat-a",
        seed_with("r2", BackgroundWorkKind::Agent, "dev server"),
        "/p/r2".to_string(),
    );
    tracker.start("chat-a", make_seed("done"), "/p/done".to_string());
    tracker.end(
        "chat-a",
        "done",
        TerminalUpdate {
            status: BackgroundTaskStatus::Completed,
            output_path: String::new(),
            summary: String::new(),
            usage: None,
        },
    );
    drain(&mut rx);

    let ended = tracker.end_all_running("chat-a");

    assert_eq!(ended, 2);
    assert!(tracker.list_live("chat-a").is_empty());
    assert_eq!(
        tracker.get("chat-a", "r1").unwrap().status,
        BackgroundTaskStatus::Stopped
    );
    assert_eq!(
        tracker.get("chat-a", "r2").unwrap().status,
        BackgroundTaskStatus::Stopped
    );
    assert_eq!(
        tracker.get("chat-a", "done").unwrap().status,
        BackgroundTaskStatus::Completed
    );
    let mut labels: Vec<String> = drain(&mut rx)
        .iter()
        .map(|ev| match ev {
            TaskEvent::Ended { task, .. } => format!("ended:{}", task.id),
            other => format!("{}:{}", event_kind(other), "?"),
        })
        .collect();
    labels.sort();
    assert_eq!(labels, vec!["ended:r1", "ended:r2"]);
}

#[test]
fn end_all_running_on_unknown_chat_is_a_no_op_returning_zero() {
    let tracker = BackgroundTaskTracker::new();
    let mut rx = tracker.subscribe();
    assert_eq!(tracker.end_all_running("chat-ghost"), 0);
    assert!(drain(&mut rx).is_empty());
}

#[test]
fn start_stamps_the_deterministic_output_path() {
    let tracker = BackgroundTaskTracker::new();
    tracker.start(
        "chat-a",
        TaskSeed {
            id: "t9".to_string(),
            kind: BackgroundWorkKind::Bash,
            tool_name: BackgroundTaskToolName::Bash,
            tool_use_id: "u9".to_string(),
            command: "pnpm dev".to_string(),
            description: "dev server".to_string(),
            workflow_name: None,
        },
        "/tmp/claude-501/-Users-x-proj/sess/tasks/t9.output".to_string(),
    );
    assert_eq!(
        tracker.get("chat-a", "t9").unwrap().output_path.as_deref(),
        Some("/tmp/claude-501/-Users-x-proj/sess/tasks/t9.output")
    );
}
