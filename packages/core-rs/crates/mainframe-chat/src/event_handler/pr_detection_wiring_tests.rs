//! `build_sink` wraps its `SessionSinkImpl` in `PrDetectionSink` (todo #339,
//! task 12) so every adapter inherits live PR detection through the one
//! construction point every session's sink comes from.

use super::*;
use crate::test_support::test_chat;

struct PrWiringDeps {
    cell: Arc<Mutex<ActiveChat>>,
    events: Mutex<Vec<DaemonEvent>>,
    persisted_prs: Mutex<Vec<DetectedPr>>,
}

impl PrWiringDeps {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            cell: Arc::new(Mutex::new(ActiveChat {
                chat: test_chat("chat-pr"),
                session: None,
                turn_started_at: None,
            })),
            events: Mutex::new(Vec::new()),
            persisted_prs: Mutex::new(Vec::new()),
        })
    }

    fn events(&self) -> Vec<DaemonEvent> {
        self.events
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
}

impl EventHandlerDeps for PrWiringDeps {
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
    fn add_detected_prs(&self, _chat_id: &str, prs: &[DetectedPr]) -> Vec<DetectedPr> {
        self.persisted_prs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .extend_from_slice(prs);
        prs.to_vec()
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
        false
    }
}

fn sink(deps: Arc<PrWiringDeps>) -> Arc<dyn SessionSink> {
    let handler = EventHandler::new(
        Arc::new(Mutex::new(MessageCache::new())),
        Arc::new(Mutex::new(PermissionManager::new())),
        deps,
    );
    handler.build_sink("chat-pr", None)
}

fn bash_create_tool_use() -> MessageContent {
    let mut input = HashMap::new();
    input.insert(
        "command".to_string(),
        serde_json::Value::String("gh pr create --title x".to_string()),
    );
    MessageContent::Node(MessageContentNode::ToolUse {
        id: "tu1".to_string(),
        name: "Bash".to_string(),
        input,
        parent_tool_use_id: None,
    })
}

fn pr_url_tool_result() -> MessageContent {
    MessageContent::Node(MessageContentNode::ToolResult {
        tool_use_id: "tu1".to_string(),
        content: "Created https://github.com/acme/repo/pull/7".to_string(),
        is_error: false,
        structured_patch: None,
        original_file: None,
        modified_file: None,
        parent_tool_use_id: None,
    })
}

#[test]
fn a_bash_pr_create_and_its_result_persist_and_emit_through_the_wired_sink() {
    let deps = PrWiringDeps::new();
    let sink = sink(deps.clone());

    sink.on_message(vec![bash_create_tool_use()], None);
    sink.on_tool_result(vec![pr_url_tool_result()], None);

    let expected = DetectedPr {
        url: "https://github.com/acme/repo/pull/7".to_string(),
        owner: "acme".to_string(),
        repo: "repo".to_string(),
        number: 7,
        source: mainframe_types::adapter::DetectedPrSource::Created,
    };
    assert_eq!(
        deps.persisted_prs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_slice(),
        std::slice::from_ref(&expected)
    );
    // The real sink also emits ChatUpdated/MessageAdded for the underlying
    // tool_use/tool_result traffic (SessionSinkImpl's own job); this asserts
    // only that ChatPrDetected — the wiring under test — is among them.
    assert!(deps.events().contains(&DaemonEvent::ChatPrDetected {
        chat_id: "chat-pr".to_string(),
        pr: expected,
    }));
}
