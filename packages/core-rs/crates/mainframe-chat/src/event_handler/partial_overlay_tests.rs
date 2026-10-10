//! Partial-message overlay (todo #350, `--include-partial-messages`): the
//! sink's `on_message_partial` merges the in-flight block into the display
//! computation feeding the chat-surface revision stream, and the completed
//! block converges in place because it lands under the same item id (the API
//! message id), never as a reset. Session-teardown/retry-ordering cases
//! moved to `teardown_tests.rs` (todo #350, plan task 37, R2.13) — it
//! shares this file's fixtures via `use super::*`.

mod teardown_tests;

use super::*;
use crate::chat_surface::{ChatSurface, ChatSurfaceEvent};
use crate::test_support::test_chat;
use mainframe_types::display::{DisplayContent, DisplayMessageType, StreamingLeafKind};

/// Deps with a 1:1 prepare (each raw message becomes one display message with
/// the same id) — enough pipeline to observe id continuity on the revision
/// stream without the Claude-specific grouping (which the adapter crate's own
/// suites pin).
#[derive(Default)]
struct OverlayDeps {
    events: Mutex<Vec<DaemonEvent>>,
    /// When true, `prepare_messages_for_client` collapses a trailing run of
    /// same-type messages into one `DisplayMessage`, keyed by the run's FIRST
    /// message (id + timestamp) — just enough of the real `group_messages`
    /// behavior (owned by `mainframe-adapter-claude`, out of this crate's dep
    /// set) to prove the overlay's own frozen timestamp survives into the
    /// group it opens. `false` keeps the flat 1:1 conversion every other test
    /// in this file relies on.
    group_consecutive: bool,
}

impl OverlayDeps {
    fn grouping() -> Self {
        Self {
            group_consecutive: true,
            ..Self::default()
        }
    }
}

impl EventHandlerDeps for OverlayDeps {
    fn get_active_chat(&self, _chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        Some(Arc::new(Mutex::new(ActiveChat::new(
            test_chat("chat-partial"),
            None,
        ))))
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
    fn get_queued_refs(&self, _chat_id: &str) -> Vec<QueuedMessageRef> {
        Vec::new()
    }
    fn display_projector(&self) -> Box<dyn DisplayProjector> {
        let group_consecutive_flag = self.group_consecutive;
        Box::new(FullRebuildProjector::new(
            move |raw, overlay, _categories| {
                let combined: Vec<ChatMessage> = match overlay {
                    Some(o) => raw
                        .iter()
                        .cloned()
                        .chain(std::iter::once(o.clone()))
                        .collect(),
                    None => raw.to_vec(),
                };
                if group_consecutive_flag {
                    group_consecutive(&combined)
                } else {
                    flat_convert(&combined)
                }
            },
        ))
    }
    fn strip_command_tags(&self, text: &str) -> String {
        text.replace("<mainframe-tag/>", "")
    }
    fn chats_update(&self, _chat_id: &str, _patch: &EventChatUpdate) {}
    fn projects_get_path(&self, _project_id: &str) -> Option<String> {
        None
    }
    fn initial_transcript_path(&self, _: &str, _: &str, _: &str) -> Option<String> {
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

/// 1:1 raw-to-display conversion (every message becomes its own
/// `DisplayMessage`, carrying only leaf content) — `OverlayDeps`'s default
/// projector, used whenever `group_consecutive` is false.
fn flat_convert(raw: &[ChatMessage]) -> Vec<DisplayMessage> {
    raw.iter()
        .map(|m| DisplayMessage {
            id: m.id.clone(),
            chat_id: m.chat_id.clone(),
            r#type: mainframe_types::display::DisplayMessageType::Assistant,
            content: m
                .content
                .iter()
                .filter_map(|c| match c {
                    MessageContent::Leaf(leaf) => Some(DisplayContent::Leaf(leaf.clone())),
                    MessageContent::Node(_) => None,
                })
                .collect(),
            timestamp: "t".to_string(),
            metadata: None,
        })
        .collect()
}

/// Groups a trailing run of same-type messages into one `DisplayMessage`,
/// using the run's first message as the base for id and timestamp — see
/// `OverlayDeps::group_consecutive`'s doc.
fn group_consecutive(raw: &[ChatMessage]) -> Vec<DisplayMessage> {
    let mut out: Vec<DisplayMessage> = Vec::new();
    for m in raw {
        let r#type = match m.r#type {
            ChatMessageType::User => DisplayMessageType::User,
            _ => DisplayMessageType::Assistant,
        };
        let leaves: Vec<DisplayContent> = m
            .content
            .iter()
            .filter_map(|c| match c {
                MessageContent::Leaf(leaf) => Some(DisplayContent::Leaf(leaf.clone())),
                MessageContent::Node(_) => None,
            })
            .collect();
        match out.last_mut() {
            Some(last) if last.r#type == r#type => last.content.extend(leaves),
            _ => out.push(DisplayMessage {
                id: m.id.clone(),
                chat_id: m.chat_id.clone(),
                r#type,
                content: leaves,
                timestamp: m.timestamp.clone(),
                metadata: None,
            }),
        }
    }
    out
}

#[derive(Default)]
struct RevisionSurface {
    revisions: Mutex<Vec<(Vec<DisplayMessage>, Option<StreamingLeafKind>)>>,
}

impl RevisionSurface {
    fn revisions(&self) -> Vec<Vec<DisplayMessage>> {
        self.revisions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .map(|(messages, _)| messages.clone())
            .collect()
    }

    fn streaming(&self) -> Vec<Option<StreamingLeafKind>> {
        self.revisions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .map(|(_, streaming)| *streaming)
            .collect()
    }
}

impl ChatSurface for RevisionSurface {
    fn on_chat_surface_event(&self, event: ChatSurfaceEvent) {
        if let ChatSurfaceEvent::DisplayRevision {
            delta, streaming, ..
        } = event
        {
            // Materialize at receipt (todo #376): the snapshot handle is
            // only valid during this synchronous call.
            let messages = delta.snapshot.materialize();
            self.revisions
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push((messages, streaming));
        }
    }
}

/// Every chat-surface event, in call order — for tests asserting relative
/// ordering across event kinds, which `RevisionSurface` throws away.
#[derive(Default)]
struct OrderSurface {
    events: Mutex<Vec<ChatSurfaceEvent>>,
}

impl OrderSurface {
    fn events(&self) -> Vec<ChatSurfaceEvent> {
        self.events
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
}

impl ChatSurface for OrderSurface {
    fn on_chat_surface_event(&self, event: ChatSurfaceEvent) {
        self.events
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(event);
    }
}

fn text(t: &str) -> MessageContent {
    MessageContent::Leaf(LeafContent::Text {
        text: t.to_string(),
        parent_tool_use_id: None,
    })
}

fn thinking(t: &str) -> MessageContent {
    MessageContent::Leaf(LeafContent::Thinking {
        thinking: t.to_string(),
        parent_tool_use_id: None,
    })
}

fn setup() -> (Arc<dyn SessionSink>, Arc<OverlayDeps>, Arc<RevisionSurface>) {
    let (sink, _messages, deps, surface) = setup_from(Arc::new(OverlayDeps::default()));
    (sink, deps, surface)
}

type SetupParts = (
    Arc<dyn SessionSink>,
    Arc<Mutex<MessageCache>>,
    Arc<OverlayDeps>,
    Arc<RevisionSurface>,
);

/// Like `setup`, but with a caller-chosen deps AND the backing `MessageCache`
/// exposed, so a test can seed history before the first partial — needed to
/// put a non-assistant message last, which makes the overlay open its OWN
/// group instead of merging into one already in the cache.
fn setup_from(deps: Arc<OverlayDeps>) -> SetupParts {
    let messages = Arc::new(Mutex::new(MessageCache::new()));
    let handler = EventHandler::new(
        messages.clone(),
        Arc::new(Mutex::new(PermissionManager::new())),
        deps.clone(),
    );
    let surface = Arc::new(RevisionSurface::default());
    handler.set_chat_surface(surface.clone());
    (
        handler.build_sink("chat-partial", None),
        messages,
        deps,
        surface,
    )
}

fn first_text(display: &DisplayMessage) -> &str {
    match &display.content[0] {
        DisplayContent::Leaf(LeafContent::Text { text, .. }) => text,
        other => panic!("expected a text leaf, got {other:?}"),
    }
}

#[test]
fn partials_stream_growing_revisions_and_completion_converges_under_the_same_id() {
    let (sink, _deps, surface) = setup();

    sink.on_message_partial("msg_1", vec![text("Riv")]);
    sink.on_message_partial("msg_1", vec![text("Rivers flow")]);
    // The completed block arrives with the SAME vendor id the overlay used
    // (assistant_event.rs's first-block rule).
    sink.on_message(
        vec![text("Rivers flow downhill.")],
        Some(MessageMetadata {
            model: None,
            usage: None,
            vendor_id: Some("msg_1".to_string()),
        }),
    );

    // Three revisions, one per emit; the id never changes, so the facade's
    // diff engine sees tail growth (chunks), never an item reset.
    let revisions = surface.revisions();
    assert_eq!(revisions.len(), 3, "one revision per emit: {revisions:?}");
    for (revision, expected) in
        revisions
            .iter()
            .zip(["Riv", "Rivers flow", "Rivers flow downhill."])
    {
        assert_eq!(revision.len(), 1);
        assert_eq!(revision[0].id, "msg_1");
        assert_eq!(first_text(&revision[0]), expected);
    }
}

#[test]
fn a_retry_drops_the_partial_content_from_the_revision_stream() {
    let (sink, _deps, surface) = setup();

    sink.on_message_partial("msg_1", vec![text("doomed partial")]);
    sink.on_api_retry(1, Some("overloaded".to_string()));

    let revisions = surface.revisions();
    assert!(
        revisions.last().is_some_and(Vec::is_empty),
        "the revision after the retry no longer carries the partial: {revisions:?}"
    );
}

#[test]
fn partial_text_gets_the_same_command_tag_stripping_as_completed_text() {
    let (sink, _deps, surface) = setup();
    sink.on_message_partial("msg_1", vec![text("before <mainframe-tag/>after")]);

    let revisions = surface.revisions();
    assert_eq!(revisions.len(), 1);
    assert_eq!(
        first_text(&revisions[0][0]),
        "before after",
        "overlay text must be stripped like on_message strips"
    );
}

/// Spec Decision 39: the overlay-backed item carries `streaming: true` only
/// while the overlay is live; the committed block that supersedes it drops
/// the flag in the very next revision.
#[test]
fn the_streaming_flag_rides_the_overlay_and_drops_on_commit() {
    let (sink, _deps, surface) = setup();

    sink.on_message_partial("msg_1", vec![text("Riv")]);
    sink.on_message(
        vec![text("Rivers flow downhill.")],
        Some(MessageMetadata {
            model: None,
            usage: None,
            vendor_id: Some("msg_1".to_string()),
        }),
    );

    let streaming = surface.streaming();
    assert_eq!(streaming.len(), 2);
    assert_eq!(
        streaming[0],
        Some(StreamingLeafKind::Text),
        "the partial streams as text"
    );
    assert_eq!(
        streaming[1], None,
        "the committed block is no longer streaming"
    );
}

#[test]
fn a_thinking_partial_streams_as_thinking() {
    let (sink, _deps, surface) = setup();

    sink.on_message_partial("msg_1", vec![thinking("pondering")]);

    let streaming = surface.streaming();
    assert_eq!(streaming.last(), Some(&Some(StreamingLeafKind::Thinking)));
}

/// Spec Decision 39: the overlay's timestamp is fixed at its first partial.
/// The cache ends with a user message, so the overlay opens its own group,
/// and that group's base — which supplies the `DisplayMessage.timestamp` —
/// is the overlay itself. This fails before the fix: `overlay_message` would
/// mint a fresh `now_iso8601()` on every partial, so the second partial's
/// group would carry a later timestamp than the first.
#[test]
fn the_overlay_timestamp_is_frozen_at_the_first_partial() {
    let (sink, messages, _deps, surface) = setup_from(Arc::new(OverlayDeps::grouping()));
    messages.lock().unwrap().append(
        "chat-partial",
        ChatMessage {
            id: "u1".to_string(),
            chat_id: "chat-partial".to_string(),
            r#type: ChatMessageType::User,
            content: vec![text("hi")],
            timestamp: "2020-01-01T00:00:00.000Z".to_string(),
            metadata: None,
        },
    );

    sink.on_message_partial("msg_1", vec![text("Riv")]);
    std::thread::sleep(std::time::Duration::from_millis(20));
    sink.on_message_partial("msg_1", vec![text("Rivers flow")]);

    let revisions = surface.revisions();
    assert_eq!(
        revisions[0].len(),
        2,
        "the user message and the overlay's own group: {:?}",
        revisions[0]
    );
    let first_overlay_timestamp = revisions[0].last().unwrap().timestamp.clone();
    let second_overlay_timestamp = revisions.last().unwrap().last().unwrap().timestamp.clone();
    assert_eq!(
        first_overlay_timestamp, second_overlay_timestamp,
        "the overlay's own group timestamp must not advance between partials"
    );
}

/// Spec Decision 39: a partial whose text strips to empty (all command-tag
/// content) never reports streaming — the display has no trailing leaf to
/// back the claim.
#[test]
fn an_overlay_that_strips_to_empty_is_not_streaming() {
    let (sink, _deps, surface) = setup();

    sink.on_message_partial("msg_1", vec![text("<mainframe-tag/>")]);

    let streaming = surface.streaming();
    assert_eq!(streaming.last(), Some(&None));
}
