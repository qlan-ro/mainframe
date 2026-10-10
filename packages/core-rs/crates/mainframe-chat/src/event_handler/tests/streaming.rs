use mainframe_types::chat_patch::ChatPatch;
use mainframe_background_tasks::tracker::{BackgroundTaskTracker, TaskSeed};
use mainframe_types::background_task::{
    BackgroundTaskStatus, BackgroundTaskToolName, BackgroundWorkKind,
};

struct BgDeps {
    cell: Arc<Mutex<ActiveChat>>,
    tracker: Arc<BackgroundTaskTracker>,
    events: Mutex<Vec<DaemonEvent>>,
    updates: Mutex<Vec<ChatPatch>>,
}
impl BgDeps {
    fn new(cell: Arc<Mutex<ActiveChat>>, tracker: Arc<BackgroundTaskTracker>) -> Arc<Self> {
        Arc::new(Self {
            cell,
            tracker,
            events: Mutex::new(Vec::new()),
            updates: Mutex::new(Vec::new()),
        })
    }
}
impl EventHandlerDeps for BgDeps {
    fn get_active_chat(&self, _chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        Some(self.cell.clone())
    }
    fn emit_event(&self, event: DaemonEvent) {
        self.events.lock().unwrap().push(event);
    }
    fn get_tool_categories(&self, _chat_id: &str) -> Option<ToolCategories> {
        None
    }
    fn on_queued_processed(&self, _chat_id: &str, _uuid: &str) {}
    fn on_queued_cleared(&self, _chat_id: &str) {}
    fn get_queued_refs(&self, _chat_id: &str) -> Vec<QueuedMessageRef> {
        Vec::new()
    }
    fn display_projector(&self) -> Box<dyn DisplayProjector> {
        Box::new(FullRebuildProjector::new(|_raw, _overlay, _categories| Vec::new()))
    }
    fn strip_command_tags(&self, text: &str) -> String {
        text.to_string()
    }
    fn chats_update(&self, _chat_id: &str, patch: &ChatPatch) {
        self.updates.lock().unwrap().push(patch.clone());
    }
    fn projects_get_path(&self, _project_id: &str) -> Option<String> {
        None
    }
    fn initial_transcript_path(&self, _: &str, _: &str, _: &str) -> Option<String> {
        None
    }
    fn add_plan_file(&self, _chat_id: &str, _file_path: &str) -> bool {
        false
    }
    fn add_skill_file(&self, _chat_id: &str, _entry: &SkillFileEntry) -> bool {
        false
    }
    fn update_todos(&self, _chat_id: &str, _todos: &[TodoItem]) {}
    fn add_detected_prs(&self, _chat_id: &str, _prs: &[DetectedPr]) -> Vec<DetectedPr> {
        Vec::new()
    }
    fn should_notify_permission(&self, _tool_name: Option<&str>) -> bool {
        false
    }
    fn notify_task_complete(&self) -> bool {
        false
    }
    fn notify_session_error(&self) -> bool {
        false
    }
    fn notify_attention_request(&self) -> bool {
        true
    }
    fn tracker_end_all_running(&self, chat_id: &str) {
        self.tracker.end_all_running(chat_id);
    }
 /// Empty on purpose: chat_deps.rs's workflow_runs_stop_all_delegates_... test covers the wiring.
    fn workflow_runs_stop_all(&self, _chat_id: &str) {}
}

fn bg_sink(deps: Arc<BgDeps>) -> Arc<dyn SessionSink> {
    let handler = EventHandler::new(
        Arc::new(Mutex::new(MessageCache::new())),
        Arc::new(Mutex::new(PermissionManager::new())),
        deps,
    );
    handler.build_sink("chat-bg", None)
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
    let deps = BgDeps::new(cell(ProcessState::Working, None), tracker.clone());

    bg_sink(deps).on_exit(Some(0));

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
    let deps = BgDeps::new(cell(ProcessState::Working, None), tracker.clone());

    bg_sink(deps).on_exit(Some(0));

    assert_eq!(tracker.list_live("other-chat").len(), 1);
}

#[test]
fn on_message_drain_turn_flips_idle_back_to_working() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let cell = cell(ProcessState::Idle, None);
    let deps = BgDeps::new(cell.clone(), tracker);

    let text = MessageContent::Leaf(LeafContent::Text {
        text: "drain-turn summary".to_string(),
        parent_tool_use_id: None,
    });
    bg_sink(deps.clone()).on_message(vec![text], None);

    assert_eq!(
        cell.lock().unwrap().chat.process_state,
        Some(Some(ProcessState::Working))
    );
    assert!(
        deps.updates
            .lock()
            .unwrap()
            .iter()
            .any(|u| { u.process_state == Some(Some(ProcessState::Working)) })
    );
    assert!(deps.events.lock().unwrap().iter().any(|e| matches!(
        e,
        DaemonEvent::ChatUpdated { chat, .. } if chat.process_state == Some(Some(ProcessState::Working))
    )));
}

#[test]
fn on_message_does_not_reflip_when_already_working() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let cell = cell(ProcessState::Working, None);
    let deps = BgDeps::new(cell, tracker);

    let text = MessageContent::Leaf(LeafContent::Text {
        text: "mid-turn message".to_string(),
        parent_tool_use_id: None,
    });
    bg_sink(deps.clone()).on_message(vec![text], None);

    assert!(
        !deps
            .events
            .lock()
            .unwrap()
            .iter()
            .any(|e| matches!(e, DaemonEvent::ChatUpdated { .. }))
    );
    assert!(
        !deps
            .updates
            .lock()
            .unwrap()
            .iter()
            .any(|u| { u.process_state == Some(Some(ProcessState::Working)) })
    );
}
