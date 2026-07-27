//! An answer naming a request the CLI already cancelled must never reach a
//! session or restart a chat (D4) — `was_cancelled` guards `respond_to_permission`
//! before it even looks for an active session.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};

use mainframe_types::adapter::ControlBehavior;

use super::*;

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
