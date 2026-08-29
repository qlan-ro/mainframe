//! An answer naming a request the CLI already cancelled must never reach a
//! session or restart a chat (D4) — `was_cancelled` guards `respond_to_permission`
//! before it even looks for an active session.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};

use mainframe_types::adapter::ControlBehavior;

use super::*;
use crate::test_support::{FakeSession, test_chat};

#[derive(Default)]
struct GuardDeps {
    start_chat_calls: Arc<AtomicUsize>,
}

impl PermissionHandlerDeps for GuardDeps {
    fn get_active_chat(&self, _chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        None
    }
    fn start_chat<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, ()> {
        self.start_chat_calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async {})
    }
    fn emit_event(&self, _event: DaemonEvent) {}
    fn emit_display(&self, _chat_id: &str) {}
    fn chats_update(&self, _chat_id: &str, _patch: &EventChatUpdate) {}
    fn get_messages<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, Vec<ChatMessage>> {
        Box::pin(async { Vec::new() })
    }
    fn should_notify_permission(&self, _tool_name: Option<&str>) -> bool {
        false
    }
    fn plan_mode_handle_no_process(
        &self,
        _chat_id: &str,
        _active: &Arc<Mutex<ActiveChat>>,
        _response: &ControlResponse,
    ) {
    }
    fn plan_mode_handle_clear_context<'a>(
        &'a self,
        _chat_id: &'a str,
        _active: Arc<Mutex<ActiveChat>>,
        _response: ControlResponse,
    ) -> BoxFuture<'a, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }
    fn plan_mode_handle_escalation<'a>(
        &'a self,
        _chat_id: &'a str,
        _active: Arc<Mutex<ActiveChat>>,
        _response: ControlResponse,
    ) -> BoxFuture<'a, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }
}

fn request(request_id: &str) -> ControlRequest {
    ControlRequest {
        request_id: request_id.to_string(),
        tool_name: "Bash".to_string(),
        tool_use_id: format!("tu-{request_id}"),
        input: HashMap::new(),
        suggestions: Vec::new(),
        decision_reason: None,
    }
}

fn allow(request_id: &str) -> ControlResponse {
    ControlResponse {
        request_id: request_id.to_string(),
        tool_use_id: format!("tu-{request_id}"),
        tool_name: None,
        behavior: ControlBehavior::Allow,
        updated_input: None,
        updated_permissions: None,
        message: None,
        execution_mode: None,
        clear_context: None,
    }
}

fn handler_with(
    permissions: PermissionManager,
) -> (Arc<AtomicUsize>, ChatPermissionHandler<GuardDeps>) {
    let start_chat_calls = Arc::new(AtomicUsize::new(0));
    let deps = GuardDeps {
        start_chat_calls: start_chat_calls.clone(),
    };
    let handler = ChatPermissionHandler::new(
        Arc::new(Mutex::new(permissions)),
        Arc::new(Mutex::new(MessageCache::new())),
        deps,
    );
    (start_chat_calls, handler)
}

#[tokio::test]
async fn an_answer_naming_a_cancelled_request_is_dropped() {
    let mut permissions = PermissionManager::new();
    permissions.enqueue("chat-1", request("r1"));
    permissions.enqueue("chat-1", request("r2"));
    permissions.cancel("chat-1", "r1");
    let (deps, handler) = handler_with(permissions);

    let result = handler.respond_to_permission("chat-1", allow("r1")).await;

    assert!(result.is_ok());
    assert_eq!(deps.load(Ordering::SeqCst), 0);
    assert_eq!(
        handler.get_pending_permission("chat-1").await,
        Some(request("r2"))
    );
}

#[tokio::test]
async fn an_answer_for_a_live_request_still_reaches_the_no_session_path() {
    let mut permissions = PermissionManager::new();
    permissions.enqueue("chat-1", request("r1"));
    permissions.enqueue("chat-1", request("r2"));
    let (deps, handler) = handler_with(permissions);

    let result = handler.respond_to_permission("chat-1", allow("r1")).await;

    assert!(result.is_ok());
    assert_eq!(deps.load(Ordering::SeqCst), 1);
}

/// Deps for the race test below: a real active session (so `respond_to_permission`
/// reaches `handle_normal_permission`), with `emit_event` calls captured for
/// inspection after the handler call returns.
struct RaceDeps {
    cell: Arc<Mutex<ActiveChat>>,
    events: Arc<Mutex<Vec<DaemonEvent>>>,
}

impl PermissionHandlerDeps for RaceDeps {
    fn get_active_chat(&self, _chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        Some(self.cell.clone())
    }
    fn start_chat<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async {})
    }
    fn emit_event(&self, event: DaemonEvent) {
        self.events.lock().unwrap().push(event);
    }
    fn emit_display(&self, _chat_id: &str) {}
    fn chats_update(&self, _chat_id: &str, _patch: &EventChatUpdate) {}
    fn get_messages<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, Vec<ChatMessage>> {
        Box::pin(async { Vec::new() })
    }
    fn should_notify_permission(&self, _tool_name: Option<&str>) -> bool {
        false
    }
    fn plan_mode_handle_no_process(
        &self,
        _chat_id: &str,
        _active: &Arc<Mutex<ActiveChat>>,
        _response: &ControlResponse,
    ) {
    }
    fn plan_mode_handle_clear_context<'a>(
        &'a self,
        _chat_id: &'a str,
        _active: Arc<Mutex<ActiveChat>>,
        _response: ControlResponse,
    ) -> BoxFuture<'a, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }
    fn plan_mode_handle_escalation<'a>(
        &'a self,
        _chat_id: &'a str,
        _active: Arc<Mutex<ActiveChat>>,
        _response: ControlResponse,
    ) -> BoxFuture<'a, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }
}

/// Pins the interleaving from #284's review: queue [r1, r2, r3]; the client
/// answers r1; while `session.respond_to_permission` is in flight, a
/// `control_cancel_request(r1)` lands and removes the front, promoting r2.
/// A blind `shift` on resume would pop r2 too and promote r3, stranding r2 as
/// "shown but unanswerable". The id-scoped `shift` must instead see its front
/// no longer matches r1 and do nothing, leaving r2 pending.
#[tokio::test]
async fn a_cancel_landing_mid_response_does_not_promote_past_the_new_front() {
    let mut permissions = PermissionManager::new();
    permissions.enqueue("chat-1", request("r1"));
    permissions.enqueue("chat-1", request("r2"));
    permissions.enqueue("chat-1", request("r3"));
    let permissions = Arc::new(Mutex::new(permissions));

    let cancel_permissions = permissions.clone();
    let session = Arc::new(FakeSession {
        spawned: true,
        on_respond_to_permission: Some(Arc::new(move || {
            cancel_permissions.lock().unwrap().cancel("chat-1", "r1");
        })),
        ..FakeSession::default()
    });
    let cell = Arc::new(Mutex::new(ActiveChat {
        chat: test_chat("chat-1"),
        session: Some(session),
        turn_started_at: None,
    }));
    let events = Arc::new(Mutex::new(Vec::new()));
    let deps = RaceDeps {
        cell,
        events: events.clone(),
    };
    let handler = ChatPermissionHandler::new(
        permissions.clone(),
        Arc::new(Mutex::new(MessageCache::new())),
        deps,
    );
    let surface = Arc::new(GateCapture::default());
    handler.set_chat_surface(surface.clone());

    let result = handler.respond_to_permission("chat-1", allow("r1")).await;

    assert!(result.is_ok());
    assert_eq!(
        permissions.lock().unwrap().get_pending("chat-1"),
        Some(&request("r2"))
    );
    drop(events);
    let promoted = surface.raised();
    assert!(promoted.is_empty(), "unexpected promotion: {promoted:?}");
}

/// Captures `GateRaised` request ids off the chat-surface seam — the only
/// place a promotion is announced now that the legacy `permission.requested`
/// frame is retired.
#[derive(Default)]
struct GateCapture {
    raised: Mutex<Vec<String>>,
}

impl GateCapture {
    fn raised(&self) -> Vec<String> {
        self.raised
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
}

impl crate::chat_surface::ChatSurface for GateCapture {
    fn on_chat_surface_event(&self, event: crate::chat_surface::ChatSurfaceEvent) {
        if let crate::chat_surface::ChatSurfaceEvent::GateRaised { request, .. } = event {
            self.raised
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push(request.request_id);
        }
    }
}

#[tokio::test]
async fn an_answer_arriving_after_the_queue_was_cleared_is_still_dropped() {
    let mut permissions = PermissionManager::new();
    permissions.enqueue("chat-1", request("r1"));
    permissions.cancel("chat-1", "r1");
    permissions.clear("chat-1");
    let (deps, handler) = handler_with(permissions);

    let result = handler.respond_to_permission("chat-1", allow("r1")).await;

    assert!(result.is_ok());
    assert_eq!(deps.load(Ordering::SeqCst), 0);
}
