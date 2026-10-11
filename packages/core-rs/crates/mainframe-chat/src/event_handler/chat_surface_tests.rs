//! The sink handler drives the chat-surface
//! observer through the turn lifecycle the legacy `DaemonEvent` stream cannot
//! express — turn accepted/started/finished with stop reason, gate
//! raised/resolved, retry, compaction, usage, and a display revision carrying
//! the same snapshot the legacy emitter computed.

use super::tests::Harness;
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
        self.events.lock_recover().clone()
    }
}

impl ChatSurface for RecordingSurface {
    fn on_chat_surface_event(&self, event: ChatSurfaceEvent) {
        self.events.lock_recover().push(event);
    }
}

fn sink_with_surface(process_state: ProcessState) -> (Arc<dyn SessionSink>, Arc<RecordingSurface>) {
    let mut chat = test_chat("chat-surface");
    chat.process_state = Some(Some(process_state));
    let h = Harness::new(Arc::new(Mutex::new(ActiveChat::new(chat, None))));
    let surface = RecordingSurface::arc();
    h.handler.set_chat_surface(surface.clone());
    (h.sink("chat-surface"), surface)
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
        options: None,
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
    sink.on_compact(Some("entry-uuid-1"));

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
fn on_api_retry_notifies_retry() {
    let (sink, surface) = sink_with_surface(ProcessState::Working);
    sink.on_api_retry(2, Some("overloaded_error".to_string()));

    assert!(surface.events().iter().any(|e| matches!(
        e,
        ChatSurfaceEvent::Retry { attempt: 2, reason: Some(r), .. } if r == "overloaded_error"
    )));
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

    // The shared fake projects 1:1 (no Claude-specific pipeline injected
    // here), so the revision carries the one message — the point under test
    // is that it fires at all, alongside (not instead of) the legacy
    // `display.message.added` path.
    assert!(
        surface.events().iter().any(
            |e| matches!(e, ChatSurfaceEvent::DisplayRevision { delta, .. } if delta.len == 1)
        )
    );
}
