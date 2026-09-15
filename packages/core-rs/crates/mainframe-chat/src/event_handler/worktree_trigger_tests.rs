//! `on_worktree_trigger` fires exactly once per tool-result batch when a
//! completed, non-error tool call may have registered a git worktree.

use super::*;
use crate::test_support::test_chat;
use std::sync::atomic::{AtomicUsize, Ordering};

struct TriggerDeps {
    cell: Arc<Mutex<ActiveChat>>,
    trigger_count: AtomicUsize,
    triggered_chat_ids: Mutex<Vec<String>>,
}

impl TriggerDeps {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            cell: cell(),
            trigger_count: AtomicUsize::new(0),
            triggered_chat_ids: Mutex::new(Vec::new()),
        })
    }
}

impl EventHandlerDeps for TriggerDeps {
    fn get_active_chat(&self, _chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        Some(self.cell.clone())
    }
    fn emit_event(&self, _event: DaemonEvent) {}
    fn get_tool_categories(&self, _chat_id: &str) -> Option<ToolCategories> {
        None
    }
    fn on_queued_processed(&self, _chat_id: &str, _uuid: &str) {}
    fn on_queued_cleared(&self, _chat_id: &str) {}
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
    fn on_worktree_trigger(&self, chat_id: &str) {
        self.trigger_count.fetch_add(1, Ordering::SeqCst);
        self.triggered_chat_ids
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(chat_id.to_string());
    }
    /// Empty on purpose: this suite exercises worktree triggers, not on_exit.
    fn tracker_end_all_running(&self, _chat_id: &str) {}
    /// Empty on purpose: chat_deps.rs's workflow_runs_stop_all_delegates_... test covers the wiring.
    fn workflow_runs_stop_all(&self, _chat_id: &str) {}
}

fn cell() -> Arc<Mutex<ActiveChat>> {
    let mut chat = test_chat("chat-wt");
    chat.process_state = Some(Some(ProcessState::Working));
    Arc::new(Mutex::new(ActiveChat {
        chat,
        session: None,
        turn_started_at: None,
    }))
}

fn sink(deps: Arc<TriggerDeps>) -> Arc<dyn SessionSink> {
    let handler = EventHandler::new(
        Arc::new(Mutex::new(MessageCache::new())),
        Arc::new(Mutex::new(PermissionManager::new())),
        deps,
    );
    handler.build_sink("chat-wt", None)
}

fn tool_use(id: &str, name: &str, command: Option<&str>) -> MessageContent {
    let mut input = HashMap::new();
    if let Some(command) = command {
        input.insert(
            "command".to_string(),
            serde_json::Value::String(command.to_string()),
        );
    }
    MessageContent::Node(MessageContentNode::ToolUse {
        id: id.to_string(),
        name: name.to_string(),
        input,
        parent_tool_use_id: None,
    })
}

fn tool_result(tool_use_id: &str, is_error: bool) -> MessageContent {
    MessageContent::Node(MessageContentNode::ToolResult {
        tool_use_id: tool_use_id.to_string(),
        content: "done".to_string(),
        is_error,
        structured_patch: None,
        original_file: None,
        modified_file: None,
        parent_tool_use_id: None,
    })
}

#[test]
fn a_bash_worktree_add_command_triggers_one_rescan_after_a_successful_result() {
    let deps = TriggerDeps::new();
    let sink = sink(deps.clone());

    sink.on_message(
        vec![tool_use(
            "tu-1",
            "Bash",
            Some("git worktree add ../wt -b feat/x"),
        )],
        None,
    );
    sink.on_tool_result(vec![tool_result("tu-1", false)], None);

    assert_eq!(deps.trigger_count.load(Ordering::SeqCst), 1);
    assert_eq!(
        deps.triggered_chat_ids.lock().unwrap().as_slice(),
        ["chat-wt"]
    );
}

#[test]
fn a_mixed_case_worktree_command_matches_case_insensitively() {
    let deps = TriggerDeps::new();
    let sink = sink(deps.clone());

    sink.on_message(
        vec![tool_use("tu-1", "Bash", Some("GIT WORKTREE LIST"))],
        None,
    );
    sink.on_tool_result(vec![tool_result("tu-1", false)], None);

    assert_eq!(deps.trigger_count.load(Ordering::SeqCst), 1);
}

#[test]
fn the_bash_tool_alias_is_recognised_too() {
    let deps = TriggerDeps::new();
    let sink = sink(deps.clone());

    sink.on_message(
        vec![tool_use("tu-1", "BashTool", Some("git worktree list"))],
        None,
    );
    sink.on_tool_result(vec![tool_result("tu-1", false)], None);

    assert_eq!(deps.trigger_count.load(Ordering::SeqCst), 1);
}

#[test]
fn an_unrelated_bash_command_never_triggers_a_rescan() {
    let deps = TriggerDeps::new();
    let sink = sink(deps.clone());

    sink.on_message(vec![tool_use("tu-1", "Bash", Some("ls -la"))], None);
    sink.on_tool_result(vec![tool_result("tu-1", false)], None);

    assert_eq!(deps.trigger_count.load(Ordering::SeqCst), 0);
}

#[test]
fn a_failed_worktree_command_result_does_not_trigger_a_rescan() {
    let deps = TriggerDeps::new();
    let sink = sink(deps.clone());

    sink.on_message(
        vec![tool_use("tu-1", "Bash", Some("git worktree add ../wt"))],
        None,
    );
    sink.on_tool_result(vec![tool_result("tu-1", true)], None);

    assert_eq!(deps.trigger_count.load(Ordering::SeqCst), 0);
}

#[test]
fn an_enter_worktree_tool_use_triggers_one_rescan_after_a_successful_result() {
    let deps = TriggerDeps::new();
    let sink = sink(deps.clone());

    sink.on_message(vec![tool_use("tu-1", "EnterWorktree", None)], None);
    sink.on_tool_result(vec![tool_result("tu-1", false)], None);

    assert_eq!(deps.trigger_count.load(Ordering::SeqCst), 1);
}

#[test]
fn two_worktree_tool_uses_resolved_in_one_batch_trigger_only_one_rescan() {
    let deps = TriggerDeps::new();
    let sink = sink(deps.clone());

    sink.on_message(
        vec![
            tool_use("tu-1", "Bash", Some("git worktree add ../wt-1")),
            tool_use("tu-2", "EnterWorktree", None),
        ],
        None,
    );
    sink.on_tool_result(
        vec![tool_result("tu-1", false), tool_result("tu-2", false)],
        None,
    );

    assert_eq!(deps.trigger_count.load(Ordering::SeqCst), 1);
}
