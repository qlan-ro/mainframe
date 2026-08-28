//! Group B task 6 (todo #350 stable-ids): live-pipeline ids == history ids,
//! run on one recorded transcript (criterion 4's replay half, plan decision
//! 5). Assistant is the kind directly comparable on both paths: the initial
//! user prompt has no live-stream counterpart (it's minted by the daemon's
//! send path, `chat_manager/send.rs` — group D's file, out of this group's
//! scope), and subagent/sidechain content mints no id on either path — it
//! splices into an *existing* parent message's content
//! (`history_subagents.rs`'s `inject_agent_children`, lines 239-264, and
//! `mainframe-chat`'s `on_subagent_child` mutate-in-place path) — so there is
//! nothing to reconcile there.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::{Arc, Mutex};

use mainframe_adapter_api::{AdapterError, LoadedSkill, SessionSink};
use mainframe_adapter_claude::events::handle_stdout;
use mainframe_adapter_claude::history_converters::convert_history_entry;
use mainframe_adapter_claude::session::ClaudeSession;
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_claude_workflows::store::ClaudeWorkflowStore;
use mainframe_types::adapter::{
    ContextUsage, ControlRequest, DetectedPr, MessageMetadata, ProviderQuota, SessionOptions,
    SessionResult,
};
use mainframe_types::chat::{ChatMessageType, MessageContent, TodoItem};
use mainframe_types::context::SkillFileEntry;
use serde_json::Value;

const FIXTURE: &str = include_str!("../src/__fixtures__/queued-command-attachment.jsonl");
const NO_VENDOR_ID_SENTINEL: &str = "NO-VENDOR-ID-FALLBACK";

/// Mirrors `message_cache::create_transient_message_with_vendor_id`'s id rule
/// (vendor id verbatim, else fall back) but with a recognizable sentinel
/// instead of a real nanoid — a missing vendor id then fails the equality
/// assertion loudly instead of coincidentally differing from history.
#[derive(Default)]
struct IdRecordingSink {
    live_message_id: Mutex<Option<String>>,
}

impl SessionSink for IdRecordingSink {
    fn on_init(&self, _session_id: &str) {}
    fn on_message(&self, _content: Vec<MessageContent>, metadata: Option<MessageMetadata>) {
        let id = metadata
            .and_then(|m| m.vendor_id)
            .unwrap_or_else(|| NO_VENDOR_ID_SENTINEL.to_string());
        *self.live_message_id.lock().unwrap() = Some(id);
    }
    fn on_tool_result(&self, _content: Vec<MessageContent>, _vendor_id: Option<String>) {}
    fn on_permission(&self, _request: ControlRequest) {}
    fn on_result(&self, _data: SessionResult) {}
    fn on_exit(&self, _code: Option<i32>) {}
    fn on_error(&self, _error: AdapterError) {}
    fn on_compact(&self) {}
    fn on_compact_start(&self) {}
    fn on_context_usage(&self, _usage: ContextUsage) {}
    fn on_plan_file(&self, _file_path: &str) {}
    fn on_skill_file(&self, _entry: SkillFileEntry) {}
    fn on_queued_processed(&self, _uuid: &str) {}
    fn on_todo_update(&self, _todos: Vec<TodoItem>) {}
    fn on_pr_detected(&self, _pr: DetectedPr) {}
    fn on_cli_message(&self, _text: &str) {}
    fn on_skill_loaded(&self, _entry: LoadedSkill) {}
    fn on_subagent_child(&self, _parent_tool_use_id: &str, _blocks: Vec<MessageContent>) {}
    fn on_provider_quota(&self, _adapter_id: &str, _quota: ProviderQuota) {}
}

fn session() -> Arc<ClaudeSession> {
    let s = Arc::new(ClaudeSession::new(
        SessionOptions {
            project_path: "/tmp".to_string(),
            chat_id: None,
            mainframe_chat_id: "test-chat-id".to_string(),
        },
        None,
        Arc::new(BackgroundTaskTracker::new()),
        Arc::new(ClaudeWorkflowStore::new()),
        mainframe_runtime::ResolvedPath::from_value("/usr/bin:/bin"),
    ));
    s.init_weak();
    s
}

fn fixture_entries() -> Vec<Value> {
    FIXTURE
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}

#[test]
fn an_assistant_messages_live_id_matches_its_history_reconstruction_id() {
    let entries = fixture_entries();
    let assistant_entry = entries
        .iter()
        .find(|e| e.get("type").and_then(Value::as_str) == Some("assistant"))
        .expect("fixture must contain an assistant entry");

    // History path: the same reload conversion `AdapterSession::load_history` runs.
    let history_message =
        convert_history_entry(assistant_entry, "c1", &mut std::collections::HashSet::new())
            .expect("assistant entry must convert to a history ChatMessage");
    assert_eq!(history_message.r#type, ChatMessageType::Assistant);

    // Live path: replay the identical JSON line through the same NDJSON
    // dispatch the CLI's stdout drives (`events::handle_stdout`).
    let session = session();
    let sink = IdRecordingSink::default();
    let line = format!("{}\n", serde_json::to_string(assistant_entry).unwrap());
    handle_stdout(&session, line.as_bytes(), &sink);
    let live_id = sink
        .live_message_id
        .lock()
        .unwrap()
        .clone()
        .expect("on_message must have fired");

    assert_eq!(live_id, history_message.id);
    assert_ne!(
        live_id, NO_VENDOR_ID_SENTINEL,
        "the fixture entry must carry a uuid for this parity check to be meaningful"
    );
}

/// The partial-streaming anchor rule on both paths: the first entry of an API
/// message claims `message.id` as its id, later blocks of the same message
/// keep their entry uuids — identically live and in reconstruction.
#[test]
fn per_api_message_first_entry_ids_match_between_live_and_history() {
    let entries: Vec<Value> = vec![
        serde_json::json!({
            "type": "assistant", "uuid": "entry-1",
            "message": { "id": "msg_A", "model": "claude",
                "content": [{ "type": "text", "text": "hello" }] }
        }),
        serde_json::json!({
            "type": "assistant", "uuid": "entry-2",
            "message": { "id": "msg_A", "model": "claude",
                "content": [{ "type": "tool_use", "id": "tu_1", "name": "Bash", "input": {} }] }
        }),
        serde_json::json!({
            "type": "assistant", "uuid": "entry-3",
            "message": { "id": "msg_B", "model": "claude",
                "content": [{ "type": "text", "text": "done" }] }
        }),
    ];

    let mut seen = std::collections::HashSet::new();
    let history_ids: Vec<String> = entries
        .iter()
        .map(|e| convert_history_entry(e, "c1", &mut seen).unwrap().id)
        .collect();

    let session = session();
    let sink = IdRecordingSink::default();
    let mut live_ids = Vec::new();
    for entry in &entries {
        let line = format!("{}\n", serde_json::to_string(entry).unwrap());
        handle_stdout(&session, line.as_bytes(), &sink);
        live_ids.push(sink.live_message_id.lock().unwrap().clone().unwrap());
    }

    assert_eq!(live_ids, vec!["msg_A", "entry-2", "msg_B"]);
    assert_eq!(live_ids, history_ids);
}
