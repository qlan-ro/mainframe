//! `get_resume_snapshot`'s transcript budget (todo #350, PR #688 review). The
//! facade calls this on every `session/resume`, and a cold chat's load walks
//! the whole JSONL — so it must happen once per resume, not once per caller
//! inside it.
//!
//! The retention tests below (todo #350 R1, D1/D2) prove the companion
//! invariant: with no per-chat message cap, a chat's cache never silently
//! drops history and never forces a resync just because it grew past the old
//! 2,000-message mark.

use super::*;
use crate::chat_surface::{ChatSurface, ChatSurfaceEvent};
use mainframe_types::chat::MessageContentNode;
use mainframe_types::content::LeafContent;

/// Records every `ChatSurfaceEvent` an attached facade session would see.
#[derive(Default)]
struct RecordingSurface {
    events: Mutex<Vec<ChatSurfaceEvent>>,
}

impl RecordingSurface {
    fn arc() -> Arc<Self> {
        Arc::new(Self::default())
    }
    fn events(&self) -> Vec<ChatSurfaceEvent> {
        self.events.lock().unwrap().clone()
    }
}

impl ChatSurface for RecordingSurface {
    fn on_chat_surface_event(&self, event: ChatSurfaceEvent) {
        self.events.lock().unwrap().push(event);
    }
}

/// A caller-chosen, stable id so a history array's length and order are easy
/// to assert on without depending on `nanoid`'s randomness.
fn numbered_message(n: usize) -> ChatMessage {
    ChatMessage {
        id: format!("h{n}"),
        chat_id: "c1".to_string(),
        r#type: ChatMessageType::Assistant,
        content: vec![MessageContent::Leaf(LeafContent::Text {
            text: n.to_string(),
            parent_tool_use_id: None,
        })],
        timestamp: "2026-07-08T00:00:00.000Z".to_string(),
        metadata: None,
    }
}

fn tool_result_content(tool_use_id: &str) -> MessageContent {
    MessageContent::Node(MessageContentNode::ToolResult {
        tool_use_id: tool_use_id.to_string(),
        content: "done".to_string(),
        is_error: false,
        structured_patch: None,
        original_file: None,
        modified_file: None,
        images: Vec::new(),
        parent_tool_use_id: None,
    })
}

/// The snapshot loads history itself, and `get_messages` restores any pending
/// permission from that same load. Asking the permission handler afterwards
/// must read what was restored, not reload the transcript to look again.
#[tokio::test]
async fn a_resume_snapshot_loads_the_transcript_once() {
    let mut chat = test_chat("c1");
    chat.claude_session_id = Some("sess-1".to_string());
    let deps = StoreDeps::with_chats(vec![chat]);
    // An EMPTY history on purpose: a non-empty one populates the message
    // cache, and the second lookup would then never reach the disk — the case
    // that leaks is the cold chat with nothing cached, which reloads per
    // caller.
    *deps.history.lock().unwrap() = Some(Vec::new());
    // Transcript present: reconcile leaves the chat's session id in place, so
    // the pending-permission lookup can still reach a history session.
    *deps.transcript_present.lock().unwrap() = Some(true);
    let mgr = ChatManager::new(deps.clone());

    let snapshot = mgr.get_resume_snapshot("c1").await;

    assert!(snapshot.pending.is_none(), "this fixture has no open gate");
    assert_eq!(
        deps.history_loads.load(Ordering::SeqCst),
        1,
        "one resume, one transcript load"
    );
}

/// D1/D2: `MessageCache` drops its per-chat cap, so a cold load and the warm
/// cache it fills must agree, in full, for a chat well past the old 2,000
/// limit.
#[tokio::test]
async fn warm_and_cold_snapshots_agree_past_two_thousand() {
    let mut chat = test_chat("c1");
    chat.claude_session_id = Some("sess-1".to_string());
    let deps = StoreDeps::with_chats(vec![chat]);
    let history: Vec<ChatMessage> = (0..2_100).map(numbered_message).collect();
    *deps.history.lock().unwrap() = Some(history.clone());
    *deps.transcript_present.lock().unwrap() = Some(true);
    let mgr = ChatManager::new(deps.clone());

    let cold_messages = mgr.get_resume_snapshot("c1").await.messages;
    assert_eq!(
        cold_messages.len(),
        2_100,
        "the cold snapshot holds every message, past the old per-chat cap"
    );

    let warm_messages = mgr.get_resume_snapshot("c1").await.messages;
    assert_eq!(
        warm_messages.len(),
        2_100,
        "the warm snapshot (served from cache) holds every message too"
    );
    assert_eq!(
        cold_messages, warm_messages,
        "a cold load and the cache it filled agree"
    );
    assert_eq!(
        deps.history_loads.load(Ordering::SeqCst),
        1,
        "the second call is served warm, from the cache, not a second disk read"
    );
}

/// D1/D2: a live append on top of a cold-loaded, past-the-cap cache must
/// extend it in place — the old per-chat trim would have silently dropped the
/// snapshot's earliest entries from under the next revision.
#[tokio::test]
async fn first_live_revision_extends_the_snapshot_prefix() {
    let mut chat = test_chat("c1");
    chat.claude_session_id = Some("sess-1".to_string());
    let deps = StoreDeps::with_chats(vec![chat]);
    let history: Vec<ChatMessage> = (0..2_100).map(numbered_message).collect();
    *deps.history.lock().unwrap() = Some(history.clone());
    *deps.transcript_present.lock().unwrap() = Some(true);
    let mgr = ChatManager::new(deps.clone());
    let surface = RecordingSurface::arc();
    let mgr = mgr.with_chat_surface(surface.clone());

    let snapshot_messages = mgr.get_resume_snapshot("c1").await.messages;
    assert_eq!(snapshot_messages.len(), 2_100);

    let sink = mgr.event_handler.build_sink("c1", None);
    sink.on_message(
        vec![MessageContent::Leaf(LeafContent::Text {
            text: "live reply".to_string(),
            parent_tool_use_id: None,
        })],
        None,
    );

    let revision = surface
        .events()
        .into_iter()
        .find_map(|e| match e {
            ChatSurfaceEvent::DisplayRevision { messages, .. } => Some(messages),
            _ => None,
        })
        .expect("on_message emits a display revision");
    assert_eq!(
        revision.len(),
        2_101,
        "the live append extends the cache by exactly one message"
    );
    assert_eq!(
        revision[..2_100],
        snapshot_messages[..],
        "the revision's prefix is byte-identical to what the cold snapshot already showed"
    );
}

/// D1/D2: crossing the old 2,000-message mark must never raise a resync — the
/// only remaining `Resync` producers are a cache rebuild under new ids and a
/// failed resume delivery, neither of which this mix exercises.
#[tokio::test]
async fn crossing_two_thousand_raises_no_resync() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let surface = RecordingSurface::arc();
    let mgr = mgr.with_chat_surface(surface.clone());
    let sink = mgr.event_handler.build_sink("c1", None);

    for n in 0..2_001 {
        match n % 4 {
            0 => sink.on_message(
                vec![MessageContent::Leaf(LeafContent::Text {
                    text: n.to_string(),
                    parent_tool_use_id: None,
                })],
                None,
            ),
            1 => {
                let message = mgr.messages.lock().unwrap().create_transient_message(
                    "c1",
                    ChatMessageType::User,
                    vec![MessageContent::Leaf(LeafContent::Text {
                        text: n.to_string(),
                        parent_tool_use_id: None,
                    })],
                    None,
                );
                mgr.messages.lock().unwrap().append("c1", message);
            }
            2 => sink.on_tool_result(vec![tool_result_content(&n.to_string())], None),
            _ => sink.on_compact(None),
        }
    }

    assert!(
        surface
            .events()
            .iter()
            .all(|e| !matches!(e, ChatSurfaceEvent::Resync { .. })),
        "crossing the old 2,000-message cap must never raise a resync"
    );
}

#[tokio::test]
async fn tool_timing_resume_reads_preserve_running_completed_and_legacy_calls() {
    use crate::message_cache::timing_tests::{result, timings, tool};
    use serde_json::json;
    use std::sync::atomic::AtomicU64;

    let mgr = ChatManager::new(StoreDeps::with_chats(vec![test_chat("c1")]));
    let clock = Arc::new(AtomicU64::new(1000));
    let now = clock.clone();
    *mgr.messages.lock().unwrap() =
        MessageCache::with_clock(Arc::new(move || now.load(Ordering::SeqCst)));
    let mut history = numbered_message(0);
    history.content = vec![tool("legacy")];
    mgr.messages.lock().unwrap().set("c1", vec![history]);
    let sink = mgr.event_handler.build_sink("c1", Some("session".into()));
    sink.on_message(vec![tool("a")], None);
    clock.store(1100, Ordering::SeqCst);
    sink.on_message(vec![tool("b")], None);
    let running = mgr.get_resume_snapshot("c1").await.messages;
    clock.store(9000, Ordering::SeqCst);
    assert_eq!(mgr.get_resume_snapshot("c1").await.messages, running);
    assert_eq!(
        timings(&mgr.messages.lock().unwrap(), "c1"),
        vec![
            serde_json::Value::Null,
            json!({"startedAt":1000}),
            json!({"startedAt":1100})
        ]
    );
    clock.store(1200, Ordering::SeqCst);
    sink.on_tool_result(vec![result("a", false)], None);
    let completed = mgr.get_resume_snapshot("c1").await.messages;
    clock.store(9900, Ordering::SeqCst);
    assert_eq!(mgr.get_resume_snapshot("c1").await.messages, completed);
    assert_eq!(
        timings(&mgr.messages.lock().unwrap(), "c1"),
        vec![
            serde_json::Value::Null,
            json!({"startedAt":1000,"completedAt":1200}),
            json!({"startedAt":1100})
        ]
    );
    assert_eq!(mgr.get_messages("c1").await.len(), 4);
}
