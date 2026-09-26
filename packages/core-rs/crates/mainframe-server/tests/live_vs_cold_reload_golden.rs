//! G3 golden test (#178, AC9, plan `## Task groups` > G3): the display graph
//! a cold-reloaded chat renders from its Claude JSONL transcript must be
//! identical to the graph the same session renders while live-streamed.
//!
//! The fixture (`fixtures/golden-session-with-tool-calls.jsonl`) is a
//! trimmed, verbatim excerpt of an actual recorded Claude Code session on
//! this machine (session `9d21c142-41f1-4474-a69e-926bea77010d`): one
//! human-typed prompt, three signature-only `thinking` entries, two `Bash`
//! tool-call turns, and a closing text turn. Every surviving entry's fields
//! are untouched; only queue bookkeeping and unrelated attachment entries
//! (which convert to nothing on either side) were dropped to keep the
//! fixture self-contained.
//!
//! This session's model emits an empty-text, signature-only `thinking` entry
//! before each real `tool_use`/`text` entry of the same API message. Live
//! appends that signature-only entry to the raw cache as its own item (keyed
//! by its own transcript uuid, since `has_representable_content` correctly
//! withholds the API-message-id claim from it — `assistant_event.rs`), and
//! `history_converters::convert_assistant_entry` now reconstructs the same
//! raw item on reload (keeping the empty `thinking` block instead of dropping
//! the entry, and withholding the same claim) so grouping in
//! `prepare_messages_for_client` picks the same *first* raw entry as the
//! display item's base id on both sides — closing what was previously a
//! real base-id divergence (AC9, decision 10).
//!
//! **Live** replays the transcript the way the daemon actually builds one:
//! - The human-typed prompt goes through
//!   `mainframe_chat::message_cache::MessageCache::create_transient_message_with_vendor_id`,
//!   forced to the transcript's own uuid — the same uuid
//!   `chat_manager::send_queue::queued_message_metadata` now mints for EVERY
//!   send (not just a queued one) and hands the CLI on stdin
//!   (`build_user_payload`'s `uuid` field), which the CLI persists verbatim
//!   as the entry's own `uuid`. This closes what was previously a permanent
//!   live-vs-reload id gap for an unqueued human message (AC9, decision 10) —
//!   see the module-level note in `chat_manager/send_queue.rs`.
//! - Every other transcript line (assistant turns AND the CLI's own
//!   tool_result echoes, both "user" and "assistant"-typed stream-json
//!   events) goes through `mainframe_adapter_claude::events::handle_stdout`
//!   into a real `EventHandler` sink and `MessageCache`, exactly as a spawned
//!   CLI process's stdout would — a live CLI does NOT echo the human's own
//!   prompt on stdout (only the daemon's send path emits that), but it does
//!   echo tool_result turns back through the same stream.
//!
//! **Cold reload** parses the same transcript through
//! `mainframe_adapter_claude::history::load_history` (the G2 stored-path
//! resolution the offload feature relies on) and remaps the embedded
//! session-id `chat_id` back to the Mainframe chat id, mirroring
//! `chat_manager::shared::remap_history`.
//!
//! **Both** then run through `prepare_messages_for_client` → `encode`, and
//! the ordered item lists are compared after normalizing only the one
//! pre-existing, unconditional field AC9 excludes: the display timestamp
//! (minted by the daemon on live receipt, never reproducible from a disk
//! read) — see `normalize` below. No exception list: every id, role, kind,
//! content, tool call, and grouping decision is compared as-is.
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
use mainframe_types::adapter::{DetectedPr, SessionOptions};
use mainframe_types::chat::{ChatMessageType, QueuedMessageRef, TodoItem};
use mainframe_types::context::SkillFileEntry;
use mainframe_types::display::{DisplayMessage, ToolCategories};
use mainframe_types::events::DaemonEvent;
use serde_json::Value;

const FIXTURE: &str = include_str!("fixtures/golden-session-with-tool-calls.jsonl");
const SESSION_ID: &str = "9d21c142-41f1-4474-a69e-926bea77010d";
const CHAT_ID: &str = "chat-golden-178";
const PROJECT_PATH: &str = "/tmp/golden-178";

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

fn fixture_entries() -> Vec<Value> {
    FIXTURE
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}

/// The human-typed prompt is the only entry whose `message.content` is a raw
/// string (Claude's own JSONL convention — see `convert_user_entry`'s
/// `Value::String` branch); every other `user`-typed entry here is the CLI
/// echoing a `tool_result` back on its own stream.
fn is_human_prompt_entry(entry: &Value) -> bool {
    entry.get("type").and_then(Value::as_str) == Some("user")
        && matches!(
            entry.get("message").and_then(|m| m.get("content")),
            Some(Value::String(_))
        )
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

/// Runs the live pipeline: the human prompt via
/// `create_transient_message_with_vendor_id`, forcing the exact uuid
/// `chat_manager::send_queue::queued_message_metadata` now mints for EVERY
/// send (not just a queued one) and hands to the CLI on stdin
/// (`build_user_payload`'s `uuid` field) — the CLI persists that same uuid as
/// the transcript entry's own `uuid`, which is what this fixture's human
/// prompt entry carries. Forcing it here is what makes a real send and a
/// cold reload agree on this item's id (module doc above, decision 10); every
/// other line goes through `handle_stdout` into a real `EventHandler` sink,
/// matching a spawned CLI process's stdout.
fn run_live_pipeline() -> Vec<mainframe_types::chat::ChatMessage> {
    let cache = Arc::new(Mutex::new(MessageCache::new()));
    let permissions = Arc::new(Mutex::new(PermissionManager::new()));
    let deps = Arc::new(NoopDeps);
    let handler = EventHandler::new(cache.clone(), permissions, deps);
    let session = claude_session();
    let sink = handler.build_sink(CHAT_ID, Some(SESSION_ID.to_string()));

    for entry in fixture_entries() {
        if is_human_prompt_entry(&entry) {
            let text = entry
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(Value::as_str)
                .expect("human prompt entry must carry string content")
                .to_string();
            let forced_uuid = entry
                .get("uuid")
                .and_then(Value::as_str)
                .expect("human prompt entry must carry its own uuid")
                .to_string();
            let message = cache
                .lock()
                .unwrap()
                .create_transient_message_with_vendor_id(
                    CHAT_ID,
                    ChatMessageType::User,
                    vec![mainframe_types::chat::MessageContent::Leaf(
                        mainframe_types::content::LeafContent::Text {
                            text,
                            parent_tool_use_id: None,
                        },
                    )],
                    None,
                    Some(forced_uuid),
                );
            cache.lock().unwrap().append(CHAT_ID, message);
            continue;
        }
        let line = format!("{}\n", serde_json::to_string(&entry).unwrap());
        handle_stdout(&session, line.as_bytes(), sink.as_ref());
    }

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

/// Strips the display timestamp — AC9's only excluded field, per plan
/// decision 10 (`docs/specs/2026-09-25-todo-178-idle-whole-chat-offload.md`):
/// the daemon mints it on live receipt, so a disk read can never reproduce
/// it. No other field, id included, is touched: `run_live_pipeline` forces
/// the human prompt's id to the transcript's own uuid (the same uuid
/// `chat_manager::send_queue::queued_message_metadata` now hands the CLI on
/// every send), and `history_converters::convert_assistant_entry` reconstructs
/// the signature-only `thinking` entries that precede each tool_use/text
/// entry so grouping picks the same base id on both sides — closing the two
/// divergences decision 10 required fixed here rather than excepted.
fn normalize(item: EncodedItem) -> EncodedItem {
    fn strip_timestamp(meta: Option<Value>) -> Option<Value> {
        let mut meta = meta?;
        let ns = meta
            .get_mut(mainframe_types::acp::extensions::MAINFRAME_META_NAMESPACE)?
            .as_object_mut()?;
        ns.remove("timestamp");
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
            meta: strip_timestamp(meta),
        },
        EncodedItem::Thought { id, content, meta } => EncodedItem::Thought {
            id,
            content,
            meta: strip_timestamp(meta),
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
            meta: strip_timestamp(meta),
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
    tokio::fs::write(&transcript_path, FIXTURE).await.unwrap();

    let live_raw = run_live_pipeline();
    let cold_raw = run_cold_reload(transcript_path.to_str().unwrap()).await;

    // Sanity: the fixture has exactly one human-typed prompt, whose uuid
    // `run_live_pipeline` forces onto the live item so it agrees with cold
    // reload's `id_or_nanoid(entry)` (module doc above).
    let human_prompt_ids: Vec<String> = fixture_entries()
        .iter()
        .filter(|e| is_human_prompt_entry(e))
        .filter_map(|e| e.get("uuid").and_then(Value::as_str).map(str::to_string))
        .collect();
    assert_eq!(
        human_prompt_ids.len(),
        1,
        "sanity: fixture must contain exactly one human-typed prompt"
    );

    let live_display = prepare_messages_for_client(&live_raw, None);
    let cold_display = prepare_messages_for_client(&cold_raw, None);

    let live_items: Vec<EncodedItem> = encode(&live_display).into_iter().map(normalize).collect();
    let cold_items: Vec<EncodedItem> = encode(&cold_display).into_iter().map(normalize).collect();

    assert_eq!(
        live_items, cold_items,
        "cold-reloaded encoded items must match the live-streamed graph"
    );
    assert!(
        live_items
            .iter()
            .any(|i| matches!(i, EncodedItem::ToolCall { .. })),
        "sanity: the fixture must exercise at least one tool call"
    );
}
