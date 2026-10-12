//! `SessionSinkImpl::on_permission_cancelled` — resolves the cancelled request,
//! promotes the next queued one (front cancel only), and never disturbs a
//! cancel of a request that was not the active one. Gate traffic is observed
//! on the chat-surface seam (the facade's feed); the legacy WS carries only
//! the `ChatUpdated` re-broadcast.

use super::tests::Harness;
use super::*;
use crate::chat_surface::ChatSurface;
use crate::test_support::test_chat;
use mainframe_types::chat::Chat;

#[derive(Default)]
struct GateSurface {
    events: Mutex<Vec<ChatSurfaceEvent>>,
}

impl GateSurface {
    fn gate_events_since(&self, from: usize) -> Vec<ChatSurfaceEvent> {
        self.events.lock_recover()[from..]
            .iter()
            .filter(|e| {
                matches!(
                    e,
                    ChatSurfaceEvent::GateRaised { .. } | ChatSurfaceEvent::GateResolved { .. }
                )
            })
            .cloned()
            .collect()
    }

    fn event_count(&self) -> usize {
        self.events.lock_recover().len()
    }
}

impl ChatSurface for GateSurface {
    fn on_chat_surface_event(&self, event: ChatSurfaceEvent) {
        self.events.lock_recover().push(event);
    }
}

fn cell() -> Arc<Mutex<ActiveChat>> {
    Arc::new(Mutex::new(ActiveChat::new(test_chat("chat-1"), None)))
}

/// A sink over "chat-1" with a gate-recording surface attached.
fn sink() -> (Arc<dyn SessionSink>, Arc<GateSurface>, Harness) {
    let h = Harness::new(cell());
    let surface = Arc::new(GateSurface::default());
    h.handler.set_chat_surface(surface.clone());
    (h.sink("chat-1"), surface, h)
}

fn events_since(h: &Harness, from: usize) -> Vec<DaemonEvent> {
    h.deps.events()[from..].to_vec()
}

fn event_count(h: &Harness) -> usize {
    h.deps.events().len()
}

/// The chat as `chat.updated` carries it: the live cell, enriched on emit.
fn current_chat(h: &Harness) -> Chat {
    let mut chat = h
        .shared
        .active("chat-1")
        .unwrap()
        .lock()
        .unwrap()
        .chat
        .clone();
    h.shared.enrich(&mut chat);
    chat
}

fn request(request_id: &str) -> ControlRequest {
    ControlRequest {
        request_id: request_id.to_string(),
        tool_name: "Bash".to_string(),
        tool_use_id: format!("tu-{request_id}"),
        input: HashMap::new(),
        suggestions: Vec::new(),
        decision_reason: None,
        options: None,
    }
}

#[test]
fn cancelling_the_active_request_resolves_it_and_promotes_the_next() {
    let (sink, surface, h) = sink();
    let permissions = h.permissions();
    sink.on_permission(request("r1"));
    sink.on_permission(request("r2"));
    let before = event_count(&h);
    let surface_before = surface.event_count();

    sink.on_permission_cancelled("r1");

    assert_eq!(
        surface.gate_events_since(surface_before),
        vec![
            ChatSurfaceEvent::GateResolved {
                chat_id: "chat-1".to_string(),
                request_id: "r1".to_string(),
            },
            ChatSurfaceEvent::GateRaised {
                chat_id: "chat-1".to_string(),
                request: request("r2"),
            },
        ]
    );
    assert_eq!(
        events_since(&h, before),
        vec![DaemonEvent::ChatUpdated {
            chat: current_chat(&h),
            reason: None,
        }]
    );
    assert_eq!(
        permissions.lock().unwrap().get_pending("chat-1"),
        Some(&request("r2"))
    );
}

#[test]
fn cancelling_the_last_request_resolves_it_and_promotes_nothing() {
    let (sink, surface, h) = sink();
    let permissions = h.permissions();
    sink.on_permission(request("r1"));
    let before = event_count(&h);
    let surface_before = surface.event_count();

    sink.on_permission_cancelled("r1");

    assert_eq!(
        surface.gate_events_since(surface_before),
        vec![ChatSurfaceEvent::GateResolved {
            chat_id: "chat-1".to_string(),
            request_id: "r1".to_string(),
        }]
    );
    assert_eq!(
        events_since(&h, before),
        vec![DaemonEvent::ChatUpdated {
            chat: current_chat(&h),
            reason: None,
        }]
    );
    assert!(!permissions.lock().unwrap().has_pending("chat-1"));
}

#[test]
fn cancelling_a_queued_request_resolves_it_without_disturbing_the_front() {
    let (sink, surface, h) = sink();
    let permissions = h.permissions();
    sink.on_permission(request("r1"));
    sink.on_permission(request("r2"));
    let before = event_count(&h);
    let surface_before = surface.event_count();

    sink.on_permission_cancelled("r2");

    assert_eq!(
        surface.gate_events_since(surface_before),
        vec![ChatSurfaceEvent::GateResolved {
            chat_id: "chat-1".to_string(),
            request_id: "r2".to_string(),
        }]
    );
    assert!(events_since(&h, before).is_empty());
    assert_eq!(
        permissions.lock().unwrap().get_pending("chat-1"),
        Some(&request("r1"))
    );
    assert_eq!(permissions.lock().unwrap().shift("chat-1", "r1"), None);
}

#[test]
fn cancelling_an_unknown_request_emits_nothing_and_leaves_the_queue() {
    let (sink, surface, h) = sink();
    let permissions = h.permissions();
    sink.on_permission(request("r1"));
    let before = event_count(&h);
    let surface_before = surface.event_count();

    sink.on_permission_cancelled("ghost");

    assert!(events_since(&h, before).is_empty());
    assert!(surface.gate_events_since(surface_before).is_empty());
    assert_eq!(
        permissions.lock().unwrap().get_pending("chat-1"),
        Some(&request("r1"))
    );
}

#[test]
fn a_cancelled_request_is_remembered_for_the_answer_guard() {
    let (sink, _surface, h) = sink();
    let permissions = h.permissions();
    sink.on_permission(request("r1"));

    sink.on_permission_cancelled("r1");

    assert!(permissions.lock().unwrap().was_cancelled("chat-1", "r1"));
}
