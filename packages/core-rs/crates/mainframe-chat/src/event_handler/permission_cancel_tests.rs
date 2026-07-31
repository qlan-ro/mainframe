//! `SessionSinkImpl::on_permission_cancelled` — resolves the cancelled request,
//! promotes the next queued one (front cancel only), and never disturbs a
//! cancel of a request that was not the active one.

use super::*;
use crate::test_support::test_chat;

struct CancelDeps {
    cell: Arc<Mutex<ActiveChat>>,
    events: Mutex<Vec<DaemonEvent>>,
}

impl CancelDeps {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            cell: cell(),
            events: Mutex::new(Vec::new()),
        })
    }

    fn events_since(&self, from: usize) -> Vec<DaemonEvent> {
        self.events.lock().unwrap_or_else(|e| e.into_inner())[from..].to_vec()
    }

    fn event_count(&self) -> usize {
        self.events.lock().unwrap_or_else(|e| e.into_inner()).len()
    }
}

impl EventHandlerDeps for CancelDeps {
    fn get_active_chat(&self, _chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        Some(self.cell.clone())
    }
    fn emit_event(&self, event: DaemonEvent) {
        self.events
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(event);
    }
    fn get_tool_categories(&self, _chat_id: &str) -> Option<ToolCategories> {
        None
    }
    fn on_queued_processed(&self, _chat_id: &str, _uuid: &str) {}
    fn on_queued_cleared(&self, _chat_id: &str) {}
    fn tracker_end_all_running(&self, _chat_id: &str) {}
    /// Empty on purpose: chat_deps.rs's workflow_runs_stop_all_delegates_... test covers the wiring.
    fn workflow_runs_stop_all(&self, _chat_id: &str) {}
    fn get_queued_refs(&self, _chat_id: &str) -> Vec<QueuedMessageRef> {
        Vec::new()
    }
    fn prepare_messages_for_client(
        &self,
        _raw: &[ChatMessage],
        _categories: Option<&ToolCategories>,
    ) -> Vec<DisplayMessage> {
        Vec::new()
    }
    fn strip_command_tags(&self, text: &str) -> String {
        text.to_string()
    }
    fn chats_update(&self, _chat_id: &str, _patch: &EventChatUpdate) {}
    fn projects_get_path(&self, _project_id: &str) -> Option<String> {
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
        true
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
}

fn cell() -> Arc<Mutex<ActiveChat>> {
    Arc::new(Mutex::new(ActiveChat {
        chat: test_chat("chat-1"),
        session: None,
        turn_started_at: None,
    }))
}

fn sink(deps: Arc<CancelDeps>, permissions: Arc<Mutex<PermissionManager>>) -> Arc<dyn SessionSink> {
    let handler = EventHandler::new(Arc::new(Mutex::new(MessageCache::new())), permissions, deps);
    handler.build_sink("chat-1", None)
}

fn request(request_id: &str) -> ControlRequest {
    ControlRequest {
        request_id: request_id.to_string(),
        tool_name: "Bash".to_string(),
        tool_use_id: format!("tu-{request_id}"),
        input: HashMap::new(),
        suggestions: Vec::new(),
        decision_reason: None,
    }
}

#[test]
fn cancelling_the_active_request_resolves_it_and_promotes_the_next() {
    let deps = CancelDeps::new();
    let permissions = Arc::new(Mutex::new(PermissionManager::new()));
    let sink = sink(deps.clone(), permissions.clone());
    sink.on_permission(request("r1"));
    sink.on_permission(request("r2"));
    let before = deps.event_count();

    sink.on_permission_cancelled("r1");

    assert_eq!(
        deps.events_since(before),
        vec![
            DaemonEvent::PermissionResolved {
                chat_id: "chat-1".to_string(),
                request_id: "r1".to_string(),
            },
            DaemonEvent::PermissionRequested {
                chat_id: "chat-1".to_string(),
                request: request("r2"),
                notify: true,
            },
            DaemonEvent::ChatUpdated {
                chat: deps.cell.lock().unwrap().chat.clone(),
                reason: None,
            },
        ]
    );
    assert_eq!(
        permissions.lock().unwrap().get_pending("chat-1"),
        Some(&request("r2"))
    );
}

#[test]
fn cancelling_the_last_request_resolves_it_and_promotes_nothing() {
    let deps = CancelDeps::new();
    let permissions = Arc::new(Mutex::new(PermissionManager::new()));
    let sink = sink(deps.clone(), permissions.clone());
    sink.on_permission(request("r1"));
    let before = deps.event_count();

    sink.on_permission_cancelled("r1");

    assert_eq!(
        deps.events_since(before),
        vec![
            DaemonEvent::PermissionResolved {
                chat_id: "chat-1".to_string(),
                request_id: "r1".to_string(),
            },
            DaemonEvent::ChatUpdated {
                chat: deps.cell.lock().unwrap().chat.clone(),
                reason: None,
            },
        ]
    );
    assert!(!permissions.lock().unwrap().has_pending("chat-1"));
}

#[test]
fn cancelling_a_queued_request_resolves_it_without_disturbing_the_front() {
    let deps = CancelDeps::new();
    let permissions = Arc::new(Mutex::new(PermissionManager::new()));
    let sink = sink(deps.clone(), permissions.clone());
    sink.on_permission(request("r1"));
    sink.on_permission(request("r2"));
    let before = deps.event_count();

    sink.on_permission_cancelled("r2");

    assert_eq!(
        deps.events_since(before),
        vec![DaemonEvent::PermissionResolved {
            chat_id: "chat-1".to_string(),
            request_id: "r2".to_string(),
        }]
    );
    assert_eq!(
        permissions.lock().unwrap().get_pending("chat-1"),
        Some(&request("r1"))
    );
    assert_eq!(permissions.lock().unwrap().shift("chat-1", "r1"), None);
}

#[test]
fn cancelling_an_unknown_request_emits_nothing_and_leaves_the_queue() {
    let deps = CancelDeps::new();
    let permissions = Arc::new(Mutex::new(PermissionManager::new()));
    let sink = sink(deps.clone(), permissions.clone());
    sink.on_permission(request("r1"));
    let before = deps.event_count();

    sink.on_permission_cancelled("ghost");

    assert!(deps.events_since(before).is_empty());
    assert_eq!(
        permissions.lock().unwrap().get_pending("chat-1"),
        Some(&request("r1"))
    );
}

#[test]
fn a_cancelled_request_is_remembered_for_the_answer_guard() {
    let deps = CancelDeps::new();
    let permissions = Arc::new(Mutex::new(PermissionManager::new()));
    let sink = sink(deps.clone(), permissions.clone());
    sink.on_permission(request("r1"));

    sink.on_permission_cancelled("r1");

    assert!(permissions.lock().unwrap().was_cancelled("chat-1", "r1"));
}
