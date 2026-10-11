//! An answer naming a request the CLI already cancelled must never reach a
//! session or restart a chat (D4) — `was_cancelled` guards `respond_to_permission`
//! before it even looks for an active session.

use mainframe_types::sync::LockExt;
use std::collections::HashMap;

use mainframe_types::adapter::ControlBehavior;

use super::*;
use crate::chat_manager::construct::Collaborators;
use crate::test_support::{FakeDeps, FakeSession, test_chat};

/// A permission handler over the shared fake with "chat-1" stored but not
/// yet active, so an answer that starts the chat is visible as its cell.
struct Harness {
    shared: Arc<ChatShared>,
    handler: ChatPermissionHandler,
}

impl Harness {
    fn new() -> Self {
        let deps = FakeDeps::with_chats(vec![test_chat("chat-1")]);
        let shared = ChatShared::new(deps);
        let collab = Collaborators::build(&shared, &Arc::new(OnceLock::new()));
        Self {
            shared,
            handler: collab.permission_handler,
        }
    }

    fn enqueue(&self, request_id: &str) {
        self.shared
            .permissions
            .lock_recover()
            .enqueue("chat-1", request(request_id));
    }

    fn cancel(&self, request_id: &str) {
        self.shared
            .permissions
            .lock_recover()
            .cancel("chat-1", request_id);
    }

    /// Whether the answer started the chat: `start_chat` loads it into the
    /// registry, so an answer that was dropped leaves no cell behind.
    fn chat_started(&self) -> bool {
        self.shared.active("chat-1").is_some()
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
        options: None,
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
        scope: None,
    }
}

#[tokio::test]
async fn an_answer_naming_a_cancelled_request_is_dropped() {
    let h = Harness::new();
    h.enqueue("r1");
    h.enqueue("r2");
    h.cancel("r1");

    let result = h.handler.respond_to_permission("chat-1", allow("r1")).await;

    assert!(result.is_ok());
    assert!(!h.chat_started());
    assert_eq!(
        h.handler.get_pending_permission("chat-1").await,
        Some(request("r2"))
    );
}

#[tokio::test]
async fn an_answer_for_a_live_request_still_reaches_the_no_session_path() {
    let h = Harness::new();
    h.enqueue("r1");
    h.enqueue("r2");

    let result = h.handler.respond_to_permission("chat-1", allow("r1")).await;

    assert!(result.is_ok());
    assert!(h.chat_started());
}

/// Pins the interleaving from #284's review: queue [r1, r2, r3]; the client
/// answers r1; while `session.respond_to_permission` is in flight, a
/// `control_cancel_request(r1)` lands and removes the front, promoting r2.
/// A blind `shift` on resume would pop r2 too and promote r3, stranding r2 as
/// "shown but unanswerable". The id-scoped `shift` must instead see its front
/// no longer matches r1 and do nothing, leaving r2 pending.
#[tokio::test]
async fn a_cancel_landing_mid_response_does_not_promote_past_the_new_front() {
    let h = Harness::new();
    h.enqueue("r1");
    h.enqueue("r2");
    h.enqueue("r3");
    let permissions = h.shared.permissions.clone();

    let cancel_permissions = permissions.clone();
    let session = Arc::new(FakeSession {
        spawned: true,
        on_respond_to_permission: Some(Arc::new(move || {
            cancel_permissions.lock().unwrap().cancel("chat-1", "r1");
        })),
        ..FakeSession::default()
    });
    let cell = Arc::new(Mutex::new(ActiveChat::new(
        test_chat("chat-1"),
        Some(session),
    )));
    h.shared.active_chats.insert("chat-1".to_string(), cell);
    let surface = Arc::new(GateCapture::default());
    h.handler.set_chat_surface(surface.clone());

    let result = h.handler.respond_to_permission("chat-1", allow("r1")).await;

    assert!(result.is_ok());
    assert_eq!(
        permissions.lock().unwrap().get_pending("chat-1"),
        Some(&request("r2"))
    );
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
        self.raised.lock_recover().clone()
    }
}

impl crate::chat_surface::ChatSurface for GateCapture {
    fn on_chat_surface_event(&self, event: crate::chat_surface::ChatSurfaceEvent) {
        if let crate::chat_surface::ChatSurfaceEvent::GateRaised { request, .. } = event {
            self.raised.lock_recover().push(request.request_id);
        }
    }
}

#[tokio::test]
async fn an_answer_arriving_after_the_queue_was_cleared_is_still_dropped() {
    let h = Harness::new();
    h.enqueue("r1");
    h.cancel("r1");
    h.shared.permissions.lock_recover().clear("chat-1");

    let result = h.handler.respond_to_permission("chat-1", allow("r1")).await;

    assert!(result.is_ok());
    assert!(!h.chat_started());
}
