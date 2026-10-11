#[test]
fn link_run_id_sets_run_id_on_a_live_task_and_emits_updated() {
    let tracker = BackgroundTaskTracker::new();
    tracker.start(
        "chat-a",
        make_seed("task-1"),
        "/tmp/spool/task-1.output".to_string(),
    );
    let mut rx = tracker.subscribe();
    tracker.link_run_id("chat-a", "task-1", "run-1", None);
    assert_eq!(
        tracker.get("chat-a", "task-1").unwrap().run_id.as_deref(),
        Some("run-1")
    );
    let events = drain(&mut rx);
    assert_eq!(events.len(), 1);
    match &events[0] {
        TaskEvent::Updated { chat_id, task } => {
            assert_eq!(chat_id, "chat-a");
            assert_eq!(task.run_id.as_deref(), Some("run-1"));
        }
        _ => panic!("expected Updated"),
    }
}

#[test]
fn link_run_id_is_a_no_op_for_an_unknown_task() {
    let tracker = BackgroundTaskTracker::new();
    let mut rx = tracker.subscribe();
    tracker.link_run_id("chat-ghost", "task-1", "run-1", None);
    assert!(drain(&mut rx).is_empty());
}

#[test]
fn link_run_id_is_a_no_op_when_the_task_already_carries_that_id() {
    let tracker = BackgroundTaskTracker::new();
    tracker.start(
        "chat-a",
        make_seed("task-1"),
        "/tmp/spool/task-1.output".to_string(),
    );
    tracker.link_run_id("chat-a", "task-1", "run-1", None);
    let mut rx = tracker.subscribe();
    tracker.link_run_id("chat-a", "task-1", "run-1", None);
    assert!(drain(&mut rx).is_empty());
}
