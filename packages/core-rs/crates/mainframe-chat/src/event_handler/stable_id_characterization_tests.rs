//! Task 4 (group B, todo #350 stable-ids): characterizes today's id sources
//! before the retrofit. Established facts 2/3 — live mints a fresh nanoid per
//! call (`create_transient_message`), history derives from the transcript
//! `uuid` (`id_or_nanoid`) — so live and replayed ids disagree. This file pins
//! the live half in-crate (the history half lives in
//! `mainframe-adapter-claude::history_converters`, which this crate cannot
//! depend on — fact 9); task 6 adds the cross-path equality test once both
//! halves derive ids the same way.
//!
//! Task 5 landed `MessageMetadata::vendor_id` / `on_tool_result`'s vendor-id
//! parameter (this crate's half of the retrofit): the no-vendor-id fallback
//! below is unchanged (still nanoid, still fresh per call), and a new test
//! pins the added invariant — same vendor id in, same `ChatMessage.id` out.

use super::*;
use crate::test_support::test_chat;

struct ShapeDeps {
    cell: Arc<Mutex<ActiveChat>>,
}

impl ShapeDeps {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            cell: Arc::new(Mutex::new(ActiveChat {
                chat: test_chat("chat-shape"),
                session: None,
                turn_started_at: None,
            })),
        })
    }
}

impl EventHandlerDeps for ShapeDeps {
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
        false
    }
    fn tracker_end_all_running(&self, _chat_id: &str) {}
    fn workflow_runs_stop_all(&self, _chat_id: &str) {}
}

fn sink(deps: Arc<ShapeDeps>) -> (Arc<dyn SessionSink>, Arc<Mutex<MessageCache>>) {
    let messages = Arc::new(Mutex::new(MessageCache::new()));
    let handler = EventHandler::new(
        messages.clone(),
        Arc::new(Mutex::new(PermissionManager::new())),
        deps,
    );
    (handler.build_sink("chat-shape", None), messages)
}

fn bash_tool_use() -> MessageContent {
    let mut input = HashMap::new();
    input.insert(
        "command".to_string(),
        serde_json::Value::String("ls -la".to_string()),
    );
    MessageContent::Node(MessageContentNode::ToolUse {
        id: "tu-1".to_string(),
        name: "Bash".to_string(),
        input,
        parent_tool_use_id: None,
    })
}

fn bash_tool_result() -> MessageContent {
    MessageContent::Node(MessageContentNode::ToolResult {
        tool_use_id: "tu-1".to_string(),
        content: "done".to_string(),
        is_error: false,
        structured_patch: None,
        original_file: None,
        modified_file: None,
        parent_tool_use_id: None,
    })
}

fn assistant_metadata() -> mainframe_types::adapter::MessageMetadata {
    mainframe_types::adapter::MessageMetadata {
        model: Some("claude-3-5-sonnet".to_string()),
        usage: None,
        vendor_id: None,
    }
}

fn cached_messages(messages: &Arc<Mutex<MessageCache>>) -> Vec<ChatMessage> {
    messages
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get("chat-shape")
        .cloned()
        .unwrap_or_default()
}

fn message_ids(messages: &Arc<Mutex<MessageCache>>) -> Vec<String> {
    cached_messages(messages)
        .iter()
        .map(|m| m.id.clone())
        .collect()
}

/// Fact 2: `create_transient_message` mints a fresh nanoid on every call — the
/// live path has no notion of a vendor-supplied id yet, so two calls with
/// byte-identical content never collapse to the same id. Task 5 threads a
/// vendor id through `MessageMetadata`; once two calls carrying the *same*
/// vendor id produce the *same* `ChatMessage.id`, this assertion goes false
/// and must be rewritten to state the new invariant (same vendor id → same
/// id; absent vendor id → nanoid fallback, still fresh).
#[test]
fn live_path_mints_a_fresh_id_per_call_regardless_of_identical_content() {
    let deps = ShapeDeps::new();
    let (sink, messages) = sink(deps.clone());

    sink.on_message(vec![bash_tool_use()], Some(assistant_metadata()));
    sink.on_message(vec![bash_tool_use()], Some(assistant_metadata()));

    let ids = message_ids(&messages);
    assert_eq!(ids.len(), 2);
    assert_ne!(
        ids[0], ids[1],
        "nanoid must mint a fresh id on every call today (no vendor id exists yet)"
    );
}

/// Criterion 12's unit-level tripwire (plan decision 5): pins the cached
/// `ChatMessage` shape for an assistant tool_use and its tool_result so the
/// id-derivation work cannot silently touch anything else. `ChatMessage` is
/// destructured exhaustively (no `..`) so an added/removed/renamed field
/// fails to compile; `id`/`timestamp` are the only two masked (bound to `_`)
/// since they are nondeterministic when no vendor id is supplied.
#[test]
fn cached_message_shape_is_pinned_for_tool_use_and_tool_result() {
    let deps = ShapeDeps::new();
    let (sink, messages) = sink(deps.clone());

    sink.on_message(vec![bash_tool_use()], Some(assistant_metadata()));
    sink.on_tool_result(vec![bash_tool_result()], None);

    let cached = cached_messages(&messages);
    assert_eq!(
        cached.len(),
        2,
        "expected exactly one cached message per sink call, got {cached:?}"
    );

    let ChatMessage {
        id: _,
        chat_id: msg_chat_id,
        r#type,
        content,
        timestamp: _,
        metadata,
    } = &cached[0];
    assert_eq!(msg_chat_id.as_str(), "chat-shape");
    assert_eq!(*r#type, ChatMessageType::Assistant);
    assert_eq!(content, &vec![bash_tool_use()]);
    let mut expected_meta = HashMap::new();
    expected_meta.insert(
        "model".to_string(),
        serde_json::Value::String("claude-3-5-sonnet".to_string()),
    );
    assert_eq!(metadata, &Some(expected_meta));

    let ChatMessage {
        id: _,
        chat_id: msg_chat_id,
        r#type,
        content,
        timestamp: _,
        metadata,
    } = &cached[1];
    assert_eq!(msg_chat_id.as_str(), "chat-shape");
    assert_eq!(*r#type, ChatMessageType::ToolResult);
    assert_eq!(content, &vec![bash_tool_result()]);
    assert_eq!(metadata, &None);
}

/// Task 5: a vendor id threaded through `MessageMetadata`/`on_tool_result`
/// becomes the `ChatMessage.id` verbatim — the invariant that falsifies this
/// file's first (pre-task-5) assertion once an adapter actually supplies one.
#[test]
fn a_shared_vendor_id_produces_the_same_message_id_on_message_and_on_tool_result() {
    let deps = ShapeDeps::new();
    let (sink, messages) = sink(deps.clone());
    let mut metadata = assistant_metadata();
    metadata.vendor_id = Some("entry-uuid-1".to_string());

    sink.on_message(vec![bash_tool_use()], Some(metadata));
    sink.on_tool_result(vec![bash_tool_result()], Some("entry-uuid-1".to_string()));

    let ids = message_ids(&messages);
    assert_eq!(
        ids,
        vec!["entry-uuid-1".to_string(), "entry-uuid-1".to_string()]
    );
}
