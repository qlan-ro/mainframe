//! G3 golden test (#178, AC9, plan `## Task groups` > G3): the display graph
//! a cold-reloaded chat renders from its Claude JSONL transcript must be
//! identical to the graph the same session renders while live-streamed.
//!
//! **Live** replays a session the way the daemon actually builds one: the
//! user prompt goes through the same message-cache primitive
//! `send_plain_text`/`store_user_message` call
//! (`mainframe_chat::message_cache::MessageCache::create_transient_message_with_vendor_id`,
//! passing the transcript's own uuid as the vendor id so a scripted replay is
//! deterministic — a live send doesn't know that id upfront, but the
//! construction primitive is identical), and each assistant stdout line goes
//! through `mainframe_adapter_claude::events::handle_stdout` into a real
//! `EventHandler` sink and `MessageCache`, exactly as a spawned CLI process's
//! stdout would.
//!
//! **Cold reload** parses the same transcript through
//! `mainframe_adapter_claude::history::load_history` (the G2 stored-path
//! resolution the offload feature relies on) and remaps the embedded
//! session-id `chat_id` back to the Mainframe chat id, mirroring
//! `chat_manager::shared::remap_history`.
//!
//! **Both** then run through `prepare_messages_for_client` → `encode`, and
//! the ordered item lists are compared after normalizing two known,
//! pre-existing, unconditional markers (see `normalize` below) that are
//! unrelated to #178 and not weakened exceptions for this feature's own
//! behavior — every other field, including tool calls and text content, is
//! compared as-is.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::{Arc, Mutex};

use mainframe_acp::encoder::{EncodedItem, encode};
use mainframe_adapter_claude::events::handle_stdout;
use mainframe_adapter_claude::history::load_history;
use mainframe_adapter_claude::messages::display_pipeline::prepare_messages_for_client;
use mainframe_adapter_claude::session::ClaudeSession;
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_chat::event_handler::{EventChatUpdate, EventHandler, EventHandlerDeps};
use mainframe_chat::message_cache::MessageCache;
use mainframe_chat::permission_manager::PermissionManager;
use mainframe_chat::types::ActiveChat;
use mainframe_claude_workflows::store::ClaudeWorkflowStore;
use mainframe_types::acp::extensions::MAINFRAME_META_NAMESPACE;
use mainframe_types::adapter::{DetectedPr, SessionOptions};
use mainframe_types::chat::{ChatMessageType, MessageContent, QueuedMessageRef, TodoItem};
use mainframe_types::content::LeafContent;
use mainframe_types::context::SkillFileEntry;
use mainframe_types::display::{DisplayMessage, ToolCategories};
use mainframe_types::events::DaemonEvent;
use serde_json::Value;

const SESSION_ID: &str = "golden-session-1f70d66b";
const CHAT_ID: &str = "chat-golden-178";
const PROJECT_PATH: &str = "/tmp/golden-178";

const USER_1_UUID: &str = "fd1b1fc9-97a6-460c-8c98-d05655c7102a";
const USER_1_TEXT: &str = "Say hello.";
const USER_2_UUID: &str = "d8e51e1f-df6b-478f-aaa0-870334432a7e";
const USER_2_TEXT: &str = "Now say goodbye.";

/// A no-op `EventHandlerDeps`: this test drives the sink purely to populate
/// the raw `MessageCache` the way a live CLI stdout stream would, and reads
/// that cache back directly rather than through the deps-mediated display
/// path, so every hook here can be inert.
struct NoopDeps;

impl EventHandlerDeps for NoopDeps {
    fn get_active_chat(&self, _chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        None
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
        _raw: &[mainframe_types::chat::ChatMessage],
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

fn text_content(text: &str) -> Vec<MessageContent> {
    vec![MessageContent::Leaf(LeafContent::Text {
        text: text.to_string(),
        parent_tool_use_id: None,
    })]
}

fn user_entry(uuid: &str, timestamp: &str, text: &str) -> Value {
    serde_json::json!({
        "type": "user",
        "uuid": uuid,
        "timestamp": timestamp,
        "sessionId": SESSION_ID,
        "message": { "role": "user", "content": [{ "type": "text", "text": text }] },
    })
}

fn assistant_entry(uuid: &str, timestamp: &str, message_id: &str, text: &str) -> Value {
    serde_json::json!({
        "type": "assistant",
        "uuid": uuid,
        "timestamp": timestamp,
        "sessionId": SESSION_ID,
        "message": { "id": message_id, "model": "claude", "content": [{ "type": "text", "text": text }] },
    })
}

/// The full recorded transcript, two turns: the cold-reload path reads every
/// line; the live path only replays the assistant lines (a real CLI never
/// echoes the user's own prompt back on stdout — the daemon's send path is
/// what puts the user turn in the cache, live or scripted).
fn transcript_entries() -> Vec<Value> {
    vec![
        user_entry(USER_1_UUID, "2026-01-01T00:00:00.000Z", USER_1_TEXT),
        assistant_entry("a-1", "2026-01-01T00:00:01.000Z", "msg-1", "Hello there."),
        user_entry(USER_2_UUID, "2026-01-01T00:00:02.000Z", USER_2_TEXT),
        assistant_entry("a-2", "2026-01-01T00:00:03.000Z", "msg-2", "Goodbye!"),
    ]
}

fn claude_session() -> Arc<ClaudeSession> {
    let session = Arc::new(ClaudeSession::new(
        SessionOptions {
            project_path: PROJECT_PATH.to_string(),
            chat_id: None,
            mainframe_chat_id: CHAT_ID.to_string(),
            session_file_path: None,
        },
        None,
        Arc::new(BackgroundTaskTracker::new()),
        Arc::new(ClaudeWorkflowStore::new()),
        mainframe_runtime::ResolvedPath::from_value("/usr/bin:/bin"),
    ));
    session.init_weak();
    session
}

/// Runs the live pipeline: user turns via the same message-cache
/// construction the send path uses, assistant turns via
/// `handle_stdout` into a real `EventHandler` sink.
fn run_live_pipeline() -> Vec<mainframe_types::chat::ChatMessage> {
    let cache = Arc::new(Mutex::new(MessageCache::new()));
    let permissions = Arc::new(Mutex::new(PermissionManager::new()));
    let deps = Arc::new(NoopDeps);
    let handler = EventHandler::new(cache.clone(), permissions, deps);
    let session = claude_session();
    let sink = handler.build_sink(CHAT_ID, Some(SESSION_ID.to_string()));

    let user_1 = cache
        .lock()
        .unwrap()
        .create_transient_message_with_vendor_id(
            CHAT_ID,
            ChatMessageType::User,
            text_content(USER_1_TEXT),
            None,
            Some(USER_1_UUID.to_string()),
        );
    cache.lock().unwrap().append(CHAT_ID, user_1);

    let assistant_1 = assistant_entry("a-1", "2026-01-01T00:00:01.000Z", "msg-1", "Hello there.");
    let line = format!("{}\n", serde_json::to_string(&assistant_1).unwrap());
    handle_stdout(&session, line.as_bytes(), sink.as_ref());

    let user_2 = cache
        .lock()
        .unwrap()
        .create_transient_message_with_vendor_id(
            CHAT_ID,
            ChatMessageType::User,
            text_content(USER_2_TEXT),
            None,
            Some(USER_2_UUID.to_string()),
        );
    cache.lock().unwrap().append(CHAT_ID, user_2);

    let assistant_2 = assistant_entry("a-2", "2026-01-01T00:00:03.000Z", "msg-2", "Goodbye!");
    let line = format!("{}\n", serde_json::to_string(&assistant_2).unwrap());
    handle_stdout(&session, line.as_bytes(), sink.as_ref());

    cache
        .lock()
        .unwrap()
        .get(CHAT_ID)
        .cloned()
        .unwrap_or_default()
}

/// Runs the cold-reload pipeline: the full transcript on disk through
/// `load_history`, then the same chat-id remap `chat_manager::shared`
/// applies before caching (`remap_history`).
async fn run_cold_reload(transcript_path: &str) -> Vec<mainframe_types::chat::ChatMessage> {
    let raw = load_history(SESSION_ID, PROJECT_PATH, Some(transcript_path)).await;
    raw.into_iter()
        .map(|mut m| {
            m.chat_id = CHAT_ID.to_string();
            m
        })
        .collect()
}

/// Strips two markers this test treats as pre-existing and unrelated to
/// #178, established while writing this test (recorded in the group's
/// decisions for the reviewer):
/// - the display timestamp (explicitly out of scope per the plan);
/// - `messageMeta.source == "history"`, which
///   `mainframe_adapter_claude::history_converters::history_meta` stamps on
///   *every* reconstructed message unconditionally
///   (`history_converters.rs`, `convert_user_entry`/`convert_assistant_entry`/
///   `convert_queued_command_entry`). It predates #178, is not toggled by
///   anything this feature touches, and marks reconstructed-vs-live
///   provenance by design — not a divergence this change introduces or can
///   fix at its source without changing unrelated, already-shipped history
///   behavior.
fn normalize(item: EncodedItem) -> EncodedItem {
    fn strip(meta: Option<Value>) -> Option<Value> {
        let mut meta = meta?;
        let ns = meta.get_mut(MAINFRAME_META_NAMESPACE)?.as_object_mut()?;
        ns.remove("timestamp");
        if let Some(mm) = ns.get_mut("messageMeta").and_then(Value::as_object_mut) {
            mm.remove("source");
            if mm.is_empty() {
                ns.remove("messageMeta");
            }
        }
        Some(meta)
    }
    match item {
        EncodedItem::Message {
            id,
            role,
            content,
            meta,
        } => EncodedItem::Message {
            id,
            role,
            content,
            meta: strip(meta),
        },
        EncodedItem::Thought { id, content, meta } => EncodedItem::Thought {
            id,
            content,
            meta: strip(meta),
        },
        EncodedItem::ToolCall {
            id,
            title,
            kind,
            status,
            raw_input,
            content,
            meta,
        } => EncodedItem::ToolCall {
            id,
            title,
            kind,
            status,
            raw_input,
            content,
            meta: strip(meta),
        },
    }
}

#[tokio::test]
async fn cold_reload_renders_the_same_graph_as_the_live_stream() {
    let dir = tempfile::tempdir().unwrap();
    // `discover_session_jsonl_files`'s sidechain scan excludes the primary
    // file from its sibling scan by matching the filename `{session_id}.jsonl`
    // (`self_name`), not the resolved path — Claude never renames the
    // transcript's basename on relocation, only its directory, so the stored
    // `session_file_path` always keeps this name in production. Naming the
    // fixture anything else here would make `discover_session_jsonl_files`
    // treat the primary file as its own sidechain and double-process it.
    let transcript_path = dir.path().join(format!("{SESSION_ID}.jsonl"));
    let contents: String = transcript_entries()
        .iter()
        .map(|e| format!("{}\n", serde_json::to_string(e).unwrap()))
        .collect();
    tokio::fs::write(&transcript_path, contents).await.unwrap();

    let live_raw = run_live_pipeline();
    let cold_raw = run_cold_reload(transcript_path.to_str().unwrap()).await;

    // Same set of raw ChatMessage ids on both paths (AC9's transcript-parity
    // half) before the display pipeline groups/filters anything.
    let mut live_ids: Vec<&str> = live_raw.iter().map(|m| m.id.as_str()).collect();
    let mut cold_ids: Vec<&str> = cold_raw.iter().map(|m| m.id.as_str()).collect();
    live_ids.sort_unstable();
    cold_ids.sort_unstable();
    assert_eq!(live_ids, cold_ids, "raw message ids must match");

    let live_display = prepare_messages_for_client(&live_raw, None);
    let cold_display = prepare_messages_for_client(&cold_raw, None);

    let live_items: Vec<EncodedItem> = encode(&live_display).into_iter().map(normalize).collect();
    let cold_items: Vec<EncodedItem> = encode(&cold_display).into_iter().map(normalize).collect();

    assert_eq!(
        live_items, cold_items,
        "cold-reloaded encoded items must match the live-streamed graph"
    );
    assert_eq!(live_items.len(), 4, "sanity: both turns must be visible");
}
