//! Task 10 (group D, todo #350): the sink handler drives the chat-surface
//! observer through the turn lifecycle the legacy `DaemonEvent` stream cannot
//! express (fact 6) — turn accepted/started/finished with stop reason, gate
//! raised/resolved, retry, compaction, usage, and a display revision carrying
//! the same snapshot the legacy emitter computed.

use super::*;
use crate::chat_surface::{ChatSurface, ChatSurfaceEvent, TurnStopReason};
use crate::test_support::test_chat;
use mainframe_types::adapter::{ContextUsage, ControlRequest, MessageUsage, SessionResult};

#[derive(Default)]
struct RecordingSurface {
    events: Mutex<Vec<ChatSurfaceEvent>>,
}

impl RecordingSurface {
    fn arc() -> Arc<Self> {
        Arc::new(Self::default())
    }
    fn events(&self) -> Vec<ChatSurfaceEvent> {
        self.events
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
}

impl ChatSurface for RecordingSurface {
    fn on_chat_surface_event(&self, event: ChatSurfaceEvent) {
        self.events
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(event);
    }
}

struct ShapeDeps {
    cell: Arc<Mutex<ActiveChat>>,
}

impl ShapeDeps {
    fn new(process_state: ProcessState) -> Arc<Self> {
        let mut chat = test_chat("chat-surface");
        chat.process_state = Some(Some(process_state));
        Arc::new(Self {
            cell: Arc::new(Mutex::new(ActiveChat {
                chat,
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

fn sink_with_surface(process_state: ProcessState) -> (Arc<dyn SessionSink>, Arc<RecordingSurface>) {
    let handler = EventHandler::new(
        Arc::new(Mutex::new(MessageCache::new())),
        Arc::new(Mutex::new(PermissionManager::new())),
        ShapeDeps::new(process_state),
    );
    let surface = RecordingSurface::arc();
    handler.set_chat_surface(surface.clone());
    (handler.build_sink("chat-surface", None), surface)
}

fn result(is_error: Option<bool>, subtype: Option<&str>) -> SessionResult {
    SessionResult {
        total_cost_usd: Some(0.0),
        usage: Some(MessageUsage {
            input_tokens: Some(0),
            output_tokens: Some(0),
            cache_creation_input_tokens: None,
            cache_read_input_tokens: None,
        }),
        context_tokens: None,
        subtype: subtype.map(str::to_string),
        result: None,
        is_error,
    }
}

#[test]
fn on_result_notifies_turn_finished_completed() {
    let (sink, surface) = sink_with_surface(ProcessState::Working);
    sink.on_result(result(None, None));

    assert!(surface.events().iter().any(|e| matches!(
        e,
        ChatSurfaceEvent::TurnFinished {
            stop_reason: TurnStopReason::Completed,
            ..
        }
    )));
}

#[test]
fn on_result_notifies_turn_finished_error_for_error_during_execution() {
    let (sink, surface) = sink_with_surface(ProcessState::Working);
    sink.on_result(result(Some(true), Some("error_during_execution")));

    assert!(surface.events().iter().any(|e| matches!(
        e,
        ChatSurfaceEvent::TurnFinished {
            stop_reason: TurnStopReason::Error,
            ..
        }
    )));
}

#[test]
fn on_exit_while_working_notifies_turn_finished_error_adapter_death_mid_turn() {
    let (sink, surface) = sink_with_surface(ProcessState::Working);
    sink.on_exit(Some(1));

    assert!(surface.events().iter().any(|e| matches!(
        e,
        ChatSurfaceEvent::TurnFinished {
            stop_reason: TurnStopReason::Error,
            ..
        }
    )));
}

#[test]
fn on_exit_while_idle_does_not_notify_turn_finished() {
    let (sink, surface) = sink_with_surface(ProcessState::Idle);
    sink.on_exit(Some(0));

    assert!(
        !surface
            .events()
            .iter()
            .any(|e| matches!(e, ChatSurfaceEvent::TurnFinished { .. }))
    );
}

#[test]
fn on_permission_notifies_gate_raised_then_cancel_notifies_gate_resolved() {
    let (sink, surface) = sink_with_surface(ProcessState::Idle);
    let request = ControlRequest {
        request_id: "req_1".to_string(),
        tool_name: "Bash".to_string(),
        tool_use_id: "toolu_1".to_string(),
        input: HashMap::new(),
        suggestions: Vec::new(),
        decision_reason: None,
    };
    sink.on_permission(request.clone());
    sink.on_permission_cancelled("req_1");

    let events = surface.events();
    assert!(events.iter().any(
        |e| matches!(e, ChatSurfaceEvent::GateRaised { request: r, .. } if r.request_id == "req_1")
    ));
    assert!(events.iter().any(
        |e| matches!(e, ChatSurfaceEvent::GateResolved { request_id, .. } if request_id == "req_1")
    ));
}

#[test]
fn on_compact_notifies_compaction() {
    let (sink, surface) = sink_with_surface(ProcessState::Idle);
    sink.on_compact();

    assert!(
        surface
            .events()
            .iter()
            .any(|e| matches!(e, ChatSurfaceEvent::Compaction { .. }))
    );
}

#[test]
fn on_context_usage_notifies_usage() {
    let (sink, surface) = sink_with_surface(ProcessState::Idle);
    sink.on_context_usage(ContextUsage {
        percentage: 42.0,
        total_tokens: 4200,
        max_tokens: 10000,
    });

    assert!(
        surface.events().iter().any(
            |e| matches!(e, ChatSurfaceEvent::Usage { usage, .. } if usage.total_tokens == 4200)
        )
    );
}

#[test]
fn on_message_notifies_display_revision_with_the_legacy_emitter_snapshot() {
    let (sink, surface) = sink_with_surface(ProcessState::Idle);
    sink.on_message(
        vec![MessageContent::Leaf(LeafContent::Text {
            text: "hi".to_string(),
            parent_tool_use_id: None,
        })],
        None,
    );

    // `ShapeDeps::prepare_messages_for_client` returns `Vec::new()` (no
    // Claude-specific pipeline injected here), so the revision fires with an
    // empty snapshot — the point under test is that it fires at all,
    // alongside (not instead of) the legacy `display.message.added` path.
    assert!(surface.events().iter().any(
        |e| matches!(e, ChatSurfaceEvent::DisplayRevision { messages, .. } if messages.is_empty())
    ));
}
