//! Resume-snapshot/live-revision overlay parity: a
//! `session/resume` snapshot taken mid-stream must carry the exact same
//! messages and `StreamingLeafKind` a live `DisplayRevision` taken at the
//! same moment would — see `event_handler::display_projection`, the shared
//! helper both paths now read through.

use super::*;
use crate::chat_surface::{ChatSurface, ChatSurfaceEvent};
use mainframe_types::content::LeafContent;
use mainframe_types::display::{DisplayContent, StreamingLeafKind};

/// Materializes each `DisplayRevision`'s snapshot at receipt:
/// the handle is only valid during the synchronous `notify` call that
/// carries it, so storing the raw event and materializing later would risk
/// reading a LATER projector state than the one this revision actually
/// carried.
#[derive(Default)]
struct RecordingSurface {
    revisions: Mutex<Vec<(Vec<DisplayMessage>, Option<StreamingLeafKind>)>>,
}

impl RecordingSurface {
    fn arc() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// Every `DisplayRevision` this surface has seen, as `(messages,
    /// streaming)`, in order.
    fn revisions(&self) -> Vec<(Vec<DisplayMessage>, Option<StreamingLeafKind>)> {
        self.revisions.lock().unwrap().clone()
    }
}

impl ChatSurface for RecordingSurface {
    fn on_chat_surface_event(&self, event: ChatSurfaceEvent) {
        if let ChatSurfaceEvent::DisplayRevision {
            delta, streaming, ..
        } = event
        {
            self.revisions
                .lock()
                .unwrap()
                .push((delta.snapshot.materialize(), streaming));
        }
    }
}

fn text(s: &str) -> MessageContent {
    MessageContent::Leaf(LeafContent::Text {
        text: s.to_string(),
        parent_tool_use_id: None,
    })
}

fn thinking(s: &str) -> MessageContent {
    MessageContent::Leaf(LeafContent::Thinking {
        thinking: s.to_string(),
        parent_tool_use_id: None,
    })
}

fn leaf_texts(messages: &[DisplayMessage]) -> Vec<&str> {
    messages
        .iter()
        .flat_map(|m| &m.content)
        .filter_map(|c| match c {
            DisplayContent::Leaf(LeafContent::Text { text, .. }) => Some(text.as_str()),
            _ => None,
        })
        .collect()
}

/// A `ChatManager` wired to a `RecordingSurface`, so a test can compare the
/// live `DisplayRevision` it just observed against `get_resume_snapshot`'s
/// own read of the same state.
fn mgr_with_surface() -> (Arc<RecordingSurface>, ChatManager) {
    let deps = StoreDeps::with_chats(vec![test_chat("c1")]);
    let mgr = ChatManager::new(deps);
    let surface = RecordingSurface::arc();
    (surface.clone(), mgr.with_chat_surface(surface))
}

#[tokio::test]
async fn a_text_partial_resume_snapshot_matches_the_live_revision() {
    let (surface, mgr) = mgr_with_surface();
    let sink = mgr.event_handler.build_sink("c1", Some("s1".to_string()));

    sink.on_message_partial("msg_1", vec![text("partial text")]);

    let live = surface.revisions().pop().expect("live revision emitted");
    let snapshot = mgr.get_resume_snapshot("c1").await;

    assert_eq!(snapshot.messages, live.0);
    assert_eq!(snapshot.streaming, live.1);
    assert_eq!(snapshot.streaming, Some(StreamingLeafKind::Text));
    assert_eq!(leaf_texts(&snapshot.messages), vec!["partial text"]);
}

#[tokio::test]
async fn a_thinking_partial_resume_snapshot_matches_the_live_revision() {
    let (surface, mgr) = mgr_with_surface();
    let sink = mgr.event_handler.build_sink("c1", Some("s1".to_string()));

    sink.on_message_partial("msg_1", vec![thinking("mulling it over")]);

    let live = surface.revisions().pop().expect("live revision emitted");
    let snapshot = mgr.get_resume_snapshot("c1").await;

    assert_eq!(snapshot.messages, live.0);
    assert_eq!(snapshot.streaming, live.1);
    assert_eq!(snapshot.streaming, Some(StreamingLeafKind::Thinking));
}

/// A later partial for the message already streaming keeps the overlay's
/// frozen `started_at` (the `PartialOverlays` contract) — both the live
/// revision and the snapshot read the SAME overlay entry, so they must
/// still agree exactly once the content has grown.
#[tokio::test]
async fn a_later_partial_for_the_same_message_still_matches_the_live_revision() {
    let (surface, mgr) = mgr_with_surface();
    let sink = mgr.event_handler.build_sink("c1", Some("s1".to_string()));

    sink.on_message_partial("msg_1", vec![text("first")]);
    sink.on_message_partial("msg_1", vec![text("first and more")]);

    let live = surface.revisions().pop().expect("live revision emitted");
    let snapshot = mgr.get_resume_snapshot("c1").await;

    assert_eq!(snapshot.messages, live.0);
    assert_eq!(leaf_texts(&snapshot.messages), vec!["first and more"]);
    assert_eq!(
        live.0.last().map(|m| m.timestamp.clone()),
        snapshot.messages.last().map(|m| m.timestamp.clone()),
        "the overlay's frozen started_at must be identical on both reads"
    );
}

/// `on_message` takes the overlay before it appends the final block, so a
/// resume snapshot taken after finalization must show the final text ONCE,
/// not streaming, and not duplicated alongside a stale overlay segment.
#[tokio::test]
async fn finalizing_the_overlay_leaves_no_duplicate_segment_in_the_snapshot() {
    let (surface, mgr) = mgr_with_surface();
    let sink = mgr.event_handler.build_sink("c1", Some("s1".to_string()));

    sink.on_message_partial("msg_1", vec![text("partial")]);
    sink.on_message(vec![text("final text")], None);

    let live = surface.revisions().pop().expect("live revision emitted");
    assert_eq!(live.1, None, "a finalized message is no longer streaming");

    let snapshot = mgr.get_resume_snapshot("c1").await;
    assert_eq!(snapshot.messages, live.0);
    assert_eq!(snapshot.streaming, None);
    assert_eq!(
        leaf_texts(&snapshot.messages),
        vec!["final text"],
        "the final text appears exactly once — no leftover overlay segment"
    );
}

#[tokio::test]
async fn a_retry_leaves_no_overlay_in_the_snapshot() {
    let (_surface, mgr) = mgr_with_surface();
    let sink = mgr.event_handler.build_sink("c1", Some("s1".to_string()));

    sink.on_message_partial("msg_1", vec![text("interrupted")]);
    sink.on_api_retry(1, Some("overloaded".to_string()));

    let snapshot = mgr.get_resume_snapshot("c1").await;
    assert_eq!(snapshot.streaming, None);
    assert!(leaf_texts(&snapshot.messages).is_empty());
}

#[tokio::test]
async fn on_result_leaves_no_overlay_in_the_snapshot() {
    let (_surface, mgr) = mgr_with_surface();
    let sink = mgr.event_handler.build_sink("c1", Some("s1".to_string()));

    sink.on_message_partial("msg_1", vec![text("interrupted")]);
    sink.on_result(mainframe_types::adapter::SessionResult {
        total_cost_usd: None,
        usage: None,
        context_tokens: None,
        subtype: None,
        result: None,
        is_error: None,
    });

    let snapshot = mgr.get_resume_snapshot("c1").await;
    assert_eq!(snapshot.streaming, None);
    assert!(leaf_texts(&snapshot.messages).is_empty());
}

#[tokio::test]
async fn the_owning_sessions_exit_leaves_no_overlay_in_the_snapshot() {
    let (_surface, mgr) = mgr_with_surface();
    let sink = mgr.event_handler.build_sink("c1", Some("s1".to_string()));

    sink.on_message_partial("msg_1", vec![text("interrupted")]);
    sink.on_exit(None);

    let snapshot = mgr.get_resume_snapshot("c1").await;
    assert_eq!(snapshot.streaming, None);
    assert!(leaf_texts(&snapshot.messages).is_empty());
}

#[tokio::test]
async fn clear_display_state_leaves_no_overlay_in_the_snapshot() {
    let (_surface, mgr) = mgr_with_surface();
    let sink = mgr.event_handler.build_sink("c1", Some("s1".to_string()));

    sink.on_message_partial("msg_1", vec![text("interrupted")]);
    mgr.event_handler.clear_display_state("c1");

    let snapshot = mgr.get_resume_snapshot("c1").await;
    assert_eq!(snapshot.streaming, None);
    assert!(leaf_texts(&snapshot.messages).is_empty());
}

/// A superseded session's `on_exit` must only clear its OWN
/// overlay entry — the newer session's overlay must still show up in the
/// snapshot exactly like it shows up live.
#[tokio::test]
async fn a_superseded_sessions_exit_does_not_clear_the_newer_sessions_overlay() {
    let (surface, mgr) = mgr_with_surface();
    let sink_s1 = mgr.event_handler.build_sink("c1", Some("s1".to_string()));
    let sink_s2 = mgr.event_handler.build_sink("c1", Some("s2".to_string()));

    sink_s1.on_message_partial("msg_1", vec![text("s1 partial")]);
    sink_s2.on_exit(None);

    let live = surface.revisions().pop().expect("live revision emitted");
    let snapshot = mgr.get_resume_snapshot("c1").await;

    assert_eq!(snapshot.messages, live.0);
    assert_eq!(snapshot.streaming, Some(StreamingLeafKind::Text));
    assert_eq!(leaf_texts(&snapshot.messages), vec!["s1 partial"]);
}

/// Today's (pre-#382) contract: with no overlay, the snapshot must equal
/// plain `get_display_messages`'s output, byte for byte.
#[tokio::test]
async fn with_no_overlay_the_snapshot_matches_plain_display_messages() {
    let deps = StoreDeps::with_chats(vec![test_chat("c1")]);
    let mgr = ChatManager::new(deps);
    mgr.messages.lock().unwrap().set(
        "c1",
        vec![mainframe_types::chat::ChatMessage {
            id: "h1".to_string(),
            chat_id: "c1".to_string(),
            r#type: ChatMessageType::Assistant,
            content: vec![text("hello")],
            timestamp: "2026-10-02T00:00:00.000Z".to_string(),
            metadata: None,
        }],
    );

    let expected = mgr.get_display_messages("c1").await.messages;
    let snapshot = mgr.get_resume_snapshot("c1").await;

    assert_eq!(snapshot.messages, expected);
    assert_eq!(snapshot.streaming, None);
}
