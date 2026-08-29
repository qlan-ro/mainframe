//! Partial-message overlay (todo #350, `--include-partial-messages`): the
//! sink's `on_message_partial` merges the in-flight block into the display
//! computation feeding the chat-surface revision stream, and the completed
//! block converges in place because it lands under the same item id (the API
//! message id), never as a reset.

use super::*;
use crate::chat_surface::{ChatSurface, ChatSurfaceEvent};
use crate::test_support::test_chat;
use mainframe_types::display::DisplayContent;

/// Deps with a 1:1 prepare (each raw message becomes one display message with
/// the same id) — enough pipeline to observe id continuity on the revision
/// stream without the Claude-specific grouping (which the adapter crate's own
/// suites pin).
#[derive(Default)]
struct OverlayDeps {
    events: Mutex<Vec<DaemonEvent>>,
}

impl EventHandlerDeps for OverlayDeps {
    fn get_active_chat(&self, _chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        Some(Arc::new(Mutex::new(ActiveChat {
            chat: test_chat("chat-partial"),
            session: None,
            turn_started_at: None,
        })))
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
    fn prepare_messages_for_client(
        &self,
        raw: &[ChatMessage],
        _categories: Option<&ToolCategories>,
    ) -> Vec<DisplayMessage> {
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
    fn strip_command_tags(&self, text: &str) -> String {
        text.replace("<mainframe-tag/>", "")
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

#[derive(Default)]
struct RevisionSurface {
    revisions: Mutex<Vec<Vec<DisplayMessage>>>,
}

impl RevisionSurface {
    fn revisions(&self) -> Vec<Vec<DisplayMessage>> {
        self.revisions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
}

impl ChatSurface for RevisionSurface {
    fn on_chat_surface_event(&self, event: ChatSurfaceEvent) {
        if let ChatSurfaceEvent::DisplayRevision { messages, .. } = event {
            self.revisions
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push(messages);
        }
    }
}

fn text(t: &str) -> MessageContent {
    MessageContent::Leaf(LeafContent::Text {
        text: t.to_string(),
        parent_tool_use_id: None,
    })
}

fn setup() -> (Arc<dyn SessionSink>, Arc<OverlayDeps>, Arc<RevisionSurface>) {
    let deps = Arc::new(OverlayDeps::default());
    let handler = EventHandler::new(
        Arc::new(Mutex::new(MessageCache::new())),
        Arc::new(Mutex::new(PermissionManager::new())),
        deps.clone(),
    );
    let surface = Arc::new(RevisionSurface::default());
    handler.set_chat_surface(surface.clone());
    (handler.build_sink("chat-partial", None), deps, surface)
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

#[test]
fn result_and_exit_clear_a_dangling_partial() {
    let (sink, _deps, surface) = setup();
    sink.on_message_partial("msg_1", vec![text("interrupted")]);
    sink.on_result(SessionResult {
        total_cost_usd: None,
        usage: None,
        context_tokens: None,
        subtype: None,
        result: None,
        is_error: None,
    });
    assert!(
        surface.revisions().last().is_some_and(Vec::is_empty),
        "an interrupted turn must not leave partial text behind"
    );
}
