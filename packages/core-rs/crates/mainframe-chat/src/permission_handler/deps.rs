//! The permission handler's injected dependency surface and its error type,
//! split out of `permission_handler.rs` (todo #350, PR #688 review) — a pure
//! move; `permission_handler` re-exports both under their original paths.

use std::sync::{Arc, Mutex};

use mainframe_adapter_api::{AdapterError, BoxFuture};
use mainframe_types::adapter::ControlResponse;
use mainframe_types::chat::ChatMessage;
use mainframe_types::events::DaemonEvent;

use crate::event_handler::{EventChatUpdate, PushOut};
use crate::types::ActiveChat;

/// Errors surfaced by permission handling. Strings cross the wire, copied verbatim.
#[derive(Debug, thiserror::Error)]
pub enum PermissionError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Adapter(#[from] AdapterError),
}

/// The injected dependency surface (mirrors the TS `PermissionHandlerDeps`).
/// `planMode` delegation is exposed as three methods so this handler need not be
/// generic over the plan-mode context; chat_manager forwards them to its
/// `PlanModeHandler`.
pub trait PermissionHandlerDeps: Send + Sync {
    fn get_active_chat(&self, chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>>;
    fn start_chat<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()>;
    fn emit_event(&self, event: DaemonEvent);
    fn emit_display(&self, chat_id: &str);
    fn chats_update(&self, chat_id: &str, patch: &EventChatUpdate);
    fn get_messages<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, Vec<ChatMessage>>;
    fn should_notify_permission(&self, tool_name: Option<&str>) -> bool;
    fn send_push(&self, _msg: PushOut) {}

    fn plan_mode_handle_no_process(
        &self,
        chat_id: &str,
        active: &Arc<Mutex<ActiveChat>>,
        response: &ControlResponse,
    );
    fn plan_mode_handle_clear_context<'a>(
        &'a self,
        chat_id: &'a str,
        active: Arc<Mutex<ActiveChat>>,
        response: ControlResponse,
    ) -> BoxFuture<'a, Result<(), AdapterError>>;
    fn plan_mode_handle_escalation<'a>(
        &'a self,
        chat_id: &'a str,
        active: Arc<Mutex<ActiveChat>>,
        response: ControlResponse,
    ) -> BoxFuture<'a, Result<(), AdapterError>>;
}
