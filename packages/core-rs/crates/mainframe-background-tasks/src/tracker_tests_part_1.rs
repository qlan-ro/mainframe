use super::*;

fn make_seed(id: &str) -> TaskSeed {
    seed_with(id, BackgroundWorkKind::Bash, "dev server")
}

fn seed_with(id: &str, kind: BackgroundWorkKind, description: &str) -> TaskSeed {
    TaskSeed {
        id: id.to_string(),
        kind,
        tool_name: BackgroundTaskToolName::Bash,
        tool_use_id: "tu-1".to_string(),
        command: "pnpm dev".to_string(),
        description: description.to_string(),
        workflow_name: None,
    }
}

fn drain(rx: &mut broadcast::Receiver<TaskEvent>) -> Vec<TaskEvent> {
    let mut out = Vec::new();
    while let Ok(ev) = rx.try_recv() {
        out.push(ev);
    }
    out
}

fn event_kind(ev: &TaskEvent) -> &'static str {
    match ev {
        TaskEvent::Started { .. } => "started",
        TaskEvent::Updated { .. } => "updated",
        TaskEvent::Ended { .. } => "ended",
    }
}

fn usage(total: i64, tools: i64, dur: i64) -> BackgroundTaskUsage {
    BackgroundTaskUsage {
        total_tokens: total,
        tool_uses: tools,
        duration_ms: dur,
    }
}

#[test]
fn records_a_started_task_lists_it_and_emits_started() {
    let tracker = BackgroundTaskTracker::new();
    let mut rx = tracker.subscribe();
    tracker.start(
        "chat-a",
        make_seed("task-1"),
        "/tmp/spool/task-1.output".to_string(),
    );
    assert_eq!(tracker.list("chat-a").len(), 1);
    assert_eq!(
        tracker.list("chat-a")[0].status,
        BackgroundTaskStatus::Running
    );
    let events = drain(&mut rx);
    assert_eq!(events.len(), 1);
    match &events[0] {
        TaskEvent::Started { chat_id, task } => {
            assert_eq!(chat_id, "chat-a");
            assert_eq!(task.id, "task-1");
            assert_eq!(task.status, BackgroundTaskStatus::Running);
        }
        _ => panic!("expected Started"),
    }
}

#[test]
fn transitions_to_completed_and_emits_ended() {
    let tracker = BackgroundTaskTracker::new();
    let mut rx = tracker.subscribe();
    tracker.start(
        "chat-a",
        make_seed("task-1"),
        "/tmp/spool/task-1.output".to_string(),
    );
    tracker.end(
        "chat-a",
        "task-1",
        TerminalUpdate {
            status: BackgroundTaskStatus::Completed,
            output_path: "/tmp/claude-501/p/s/tasks/task-1.output".to_string(),
            summary: "done".to_string(),
            usage: Some(usage(100, 1, 1000)),
        },
    );
    let t = tracker.get("chat-a", "task-1").unwrap();
    assert_eq!(t.status, BackgroundTaskStatus::Completed);
    assert_eq!(
        t.output_path.as_deref(),
        Some("/tmp/claude-501/p/s/tasks/task-1.output")
    );
    assert!(t.ended_at.unwrap() > 0);
    let events = drain(&mut rx);
    match events.last().unwrap() {
        TaskEvent::Ended { chat_id, task } => {
            assert_eq!(chat_id, "chat-a");
            assert_eq!(task, &t);
        }
        _ => panic!("expected Ended"),
    }
}

#[test]
fn preserves_start_time_output_path_when_end_sends_empty_string() {
    let tracker = BackgroundTaskTracker::new();
    tracker.start(
        "chat-a",
        make_seed("task-1"),
        "/tmp/spool/task-1.output".to_string(),
    );
    tracker.end(
        "chat-a",
        "task-1",
        TerminalUpdate {
            status: BackgroundTaskStatus::Stopped,
            output_path: String::new(),
            summary: "killed".to_string(),
            usage: None,
        },
    );
    assert_eq!(
        tracker
            .get("chat-a", "task-1")
            .unwrap()
            .output_path
            .as_deref(),
        Some("/tmp/spool/task-1.output")
    );
}

#[test]
fn tolerates_end_without_start() {
    let tracker = BackgroundTaskTracker::new();
    let mut rx = tracker.subscribe();
    let r = tracker.end(
        "chat-a",
        "ghost",
        TerminalUpdate {
            status: BackgroundTaskStatus::Completed,
            output_path: "x".to_string(),
            summary: String::new(),
            usage: None,
        },
    );
    assert!(r.is_none());
    assert!(tracker.list("chat-a").is_empty());
    assert!(drain(&mut rx).is_empty());
}

#[test]
fn dedups_terminal_status() {
    let tracker = BackgroundTaskTracker::new();
    let mut rx = tracker.subscribe();
    tracker.start(
        "chat-a",
        make_seed("task-1"),
        "/tmp/spool/task-1.output".to_string(),
    );
    tracker.end(
        "chat-a",
        "task-1",
        TerminalUpdate {
            status: BackgroundTaskStatus::Completed,
            output_path: "x".to_string(),
            summary: String::new(),
            usage: None,
        },
    );
    let before = drain(&mut rx).len();
    tracker.end(
        "chat-a",
        "task-1",
        TerminalUpdate {
            status: BackgroundTaskStatus::Failed,
            output_path: "y".to_string(),
            summary: String::new(),
            usage: None,
        },
    );
    assert_eq!(
        drain(&mut rx).len(),
        0,
        "second end emits nothing (before={before})"
    );
    assert_eq!(
        tracker.get("chat-a", "task-1").unwrap().status,
        BackgroundTaskStatus::Completed
    );
}

#[test]
fn isolates_per_chat() {
    let tracker = BackgroundTaskTracker::new();
    tracker.start("chat-a", make_seed("a"), "/tmp/spool/a.output".to_string());
    tracker.start("chat-b", make_seed("b"), "/tmp/spool/b.output".to_string());
    assert_eq!(
        tracker
            .list("chat-a")
            .into_iter()
            .map(|t| t.id)
            .collect::<Vec<_>>(),
        vec!["a"]
    );
    assert_eq!(
        tracker
            .list("chat-b")
            .into_iter()
            .map(|t| t.id)
            .collect::<Vec<_>>(),
        vec!["b"]
    );
}

#[test]
fn remove_chat_drops_all_tasks() {
    let tracker = BackgroundTaskTracker::new();
    tracker.start(
        "chat-a",
        make_seed("task-1"),
        "/tmp/spool/task-1.output".to_string(),
    );
    tracker.remove_chat("chat-a");
    assert!(tracker.list("chat-a").is_empty());
}

fn recovered_task(
    id: &str,
    output_path: &str,
    started_at: i64,
    status: BackgroundTaskStatus,
) -> BackgroundTask {
    BackgroundTask {
        id: id.to_string(),
        kind: BackgroundWorkKind::Bash,
        tool_name: BackgroundTaskToolName::Bash,
        tool_use_id: String::new(),
        command: "<recovered>".to_string(),
        description: String::new(),
        output_path: Some(output_path.to_string()),
        started_at,
        ended_at: None,
        status,
        last_output_line: None,
        summary: None,
        usage: None,
        recovered: Some(true),
        workflow_name: None,
        run_id: None,
    }
}

#[test]
fn adopt_inserts_without_emitting() {
    let tracker = BackgroundTaskTracker::new();
    let mut rx = tracker.subscribe();
    tracker.adopt(
        "chat-a",
        recovered_task(
            "rec-1",
            "/tmp/claude-501/-x/sess/tasks/rec-1.output",
            1000,
            BackgroundTaskStatus::Running,
        ),
        AdoptOptions { emit: false },
    );
    assert_eq!(tracker.list("chat-a").len(), 1);
    assert_eq!(
        tracker.get("chat-a", "rec-1").unwrap().recovered,
        Some(true)
    );
    assert_eq!(tracker.get("chat-a", "rec-1").unwrap().started_at, 1000);
    assert!(drain(&mut rx).is_empty());
}
