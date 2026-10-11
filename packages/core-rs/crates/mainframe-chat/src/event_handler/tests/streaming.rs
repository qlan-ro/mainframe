use mainframe_background_tasks::tracker::{BackgroundTaskTracker, TaskSeed};
use mainframe_types::background_task::{
    BackgroundTaskStatus, BackgroundTaskToolName, BackgroundWorkKind,
};

/// A sink over `cell`, whose exit ends the live tasks in `tracker`.
fn bg_harness(cell: Arc<Mutex<ActiveChat>>, tracker: Arc<BackgroundTaskTracker>) -> Harness {
    let deps = FakeDeps::arc();
    *deps.emitter.tracker.lock().unwrap() = Some(tracker);
    Harness::with_deps(deps, cell)
}

fn seed(id: &str, kind: BackgroundWorkKind, command: &str, description: &str) -> TaskSeed {
    TaskSeed {
        id: id.to_string(),
        kind,
        tool_name: BackgroundTaskToolName::Bash,
        tool_use_id: format!("tu-{id}"),
        command: command.to_string(),
        description: description.to_string(),
        workflow_name: None,
    }
}

#[test]
fn on_exit_stops_every_running_task() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    tracker.start(
        "chat-bg",
        seed("a-1", BackgroundWorkKind::Agent, "", "agent"),
        "/p/a-1".to_string(),
    );
    tracker.start(
        "chat-bg",
        seed("b-1", BackgroundWorkKind::Bash, "dev", ""),
        "/p/b-1".to_string(),
    );
    let h = bg_harness(cell_named("chat-bg", ProcessState::Working, None), tracker.clone());

    h.sink("chat-bg").on_exit(Some(0));

    assert!(tracker.list_live("chat-bg").is_empty());
    assert_eq!(
        tracker.get("chat-bg", "a-1").unwrap().status,
        BackgroundTaskStatus::Stopped
    );
    assert_eq!(
        tracker.get("chat-bg", "b-1").unwrap().status,
        BackgroundTaskStatus::Stopped
    );
}

#[test]
fn on_exit_does_not_touch_other_chats() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    tracker.start(
        "other-chat",
        seed("x-1", BackgroundWorkKind::Bash, "c", ""),
        "/p/x-1".to_string(),
    );
    let h = bg_harness(cell_named("chat-bg", ProcessState::Working, None), tracker.clone());

    h.sink("chat-bg").on_exit(Some(0));

    assert_eq!(tracker.list_live("other-chat").len(), 1);
}

#[test]
fn on_message_drain_turn_flips_idle_back_to_working() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let cell = cell_named("chat-bg", ProcessState::Idle, None);
    let h = bg_harness(cell.clone(), tracker);

    let text = MessageContent::Leaf(LeafContent::Text {
        text: "drain-turn summary".to_string(),
        parent_tool_use_id: None,
    });
    h.sink("chat-bg").on_message(vec![text], None);

    assert_eq!(
        cell.lock().unwrap().chat.process_state,
        Some(Some(ProcessState::Working))
    );
    assert!(
        h.deps
            .store
            .updates
            .lock()
            .unwrap()
            .iter()
            .any(|(_, u)| { u.process_state == Some(Some(ProcessState::Working)) })
    );
    assert!(h.deps.events().iter().any(|e| matches!(
        e,
        DaemonEvent::ChatUpdated { chat, .. } if chat.process_state == Some(Some(ProcessState::Working))
    )));
}

#[test]
fn on_message_does_not_reflip_when_already_working() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let cell = cell_named("chat-bg", ProcessState::Working, None);
    let h = bg_harness(cell, tracker);

    let text = MessageContent::Leaf(LeafContent::Text {
        text: "mid-turn message".to_string(),
        parent_tool_use_id: None,
    });
    h.sink("chat-bg").on_message(vec![text], None);

    assert!(
        !h.deps
            .events()
            .iter()
            .any(|e| matches!(e, DaemonEvent::ChatUpdated { .. }))
    );
    assert!(
        !h.deps
            .store
            .updates
            .lock()
            .unwrap()
            .iter()
            .any(|(_, u)| { u.process_state == Some(Some(ProcessState::Working)) })
    );
}
