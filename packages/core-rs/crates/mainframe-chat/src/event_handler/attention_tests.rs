//! `SessionSinkImpl::on_attention_request` — the sink side of Claude's
//! `PushNotification` tool call (todo #293): gate, dedupe, then notify+push.

use std::sync::atomic::{AtomicBool, Ordering};

use super::*;
use crate::test_support::test_chat;

struct AttentionDeps {
    cell: Arc<Mutex<ActiveChat>>,
    events: Mutex<Vec<DaemonEvent>>,
    pushes: Mutex<Vec<PushOut>>,
    notify_attention_request: AtomicBool,
}

impl AttentionDeps {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            cell: Arc::new(Mutex::new(ActiveChat {
                chat: test_chat("chat-1"),
                session: None,
                turn_started_at: None,
            })),
            events: Mutex::new(Vec::new()),
            pushes: Mutex::new(Vec::new()),
            notify_attention_request: AtomicBool::new(true),
        })
    }

    fn events(&self) -> Vec<DaemonEvent> {
        self.events
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    fn pushes(&self) -> Vec<PushOut> {
        self.pushes
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
}

impl EventHandlerDeps for AttentionDeps {
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
        self.notify_attention_request.load(Ordering::SeqCst)
    }
    fn send_push(&self, msg: PushOut) {
        self.pushes
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(msg);
    }
}

fn sink(deps: Arc<AttentionDeps>) -> Arc<dyn SessionSink> {
    let permissions = Arc::new(Mutex::new(PermissionManager::new()));
    let handler = EventHandler::new(Arc::new(Mutex::new(MessageCache::new())), permissions, deps);
    handler.build_sink("chat-1", None)
}

#[test]
fn one_call_raises_one_notification_and_push() {
    let deps = AttentionDeps::new();
    let sink = sink(deps.clone());

    sink.on_attention_request("please confirm before I continue");

    assert_eq!(
        deps.events(),
        vec![DaemonEvent::ChatNotification {
            chat_id: "chat-1".to_string(),
            title: "Claude needs your attention".to_string(),
            body: "please confirm before I continue".to_string(),
            level: ChatNotificationLevel::Success,
            kind: Some(ChatNotificationKind::AttentionRequest),
        }]
    );
    assert_eq!(
        deps.pushes(),
        vec![PushOut {
            chat_id: "chat-1".to_string(),
            title: "Claude needs your attention".to_string(),
            body: "please confirm before I continue".to_string(),
            push_type: "attention_request".to_string(),
            priority: "high".to_string(),
        }]
    );
}

#[test]
fn toggling_the_setting_off_raises_nothing() {
    let deps = AttentionDeps::new();
    deps.notify_attention_request.store(false, Ordering::SeqCst);
    let sink = sink(deps.clone());

    sink.on_attention_request("please confirm");

    assert!(deps.events().is_empty());
    assert!(deps.pushes().is_empty());
}

#[test]
fn the_same_message_twice_is_deduped_to_one() {
    let deps = AttentionDeps::new();
    let sink = sink(deps.clone());

    sink.on_attention_request("please confirm");
    sink.on_attention_request("please confirm");

    assert_eq!(deps.events().len(), 1);
    assert_eq!(deps.pushes().len(), 1);
}

#[test]
fn empty_and_whitespace_only_raise_nothing() {
    let deps = AttentionDeps::new();
    let sink = sink(deps.clone());

    sink.on_attention_request("");
    sink.on_attention_request("   \n\t ");

    assert!(deps.events().is_empty());
    assert!(deps.pushes().is_empty());
}

#[test]
fn a_long_message_is_truncated_to_200_chars() {
    let deps = AttentionDeps::new();
    let sink = sink(deps.clone());
    let long = "a".repeat(250);

    sink.on_attention_request(&long);

    let events = deps.events();
    let DaemonEvent::ChatNotification { body, .. } = &events[0] else {
        panic!("expected a ChatNotification");
    };
    assert_eq!(body.chars().count(), 200);
    assert!(body.ends_with('\u{2026}'));
}

/// Spec D7 / AC7: dedupe keys on exact message text, not the truncated
/// display body — two long messages sharing a 199-char prefix must not
/// collapse into one notification (regression for the truncated-key bug).
#[test]
fn two_long_messages_sharing_a_199_char_prefix_both_notify() {
    let deps = AttentionDeps::new();
    let sink = sink(deps.clone());
    let prefix = "a".repeat(199);
    let first = format!("{prefix}1 tail that pushes it well past 200 chars total");
    let second = format!("{prefix}2 a completely different tail after the shared prefix");

    sink.on_attention_request(&first);
    sink.on_attention_request(&second);

    assert_eq!(deps.events().len(), 2);
    assert_eq!(deps.pushes().len(), 2);
}
