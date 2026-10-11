//! The chat layer's view of the orchestration MCP server. This crate cannot
//! depend on `mainframe-orchestration` (it sits above the chat layer), so the
//! daemon attaches an implementation after both exist, the same post-build
//! pattern as the chat surface. A manager with nothing attached (every test
//! harness) spawns chats without the tools.

use std::sync::{Arc, OnceLock};

use mainframe_adapter_api::BoxFuture;
use mainframe_types::orchestration::{AgentOutboxEntry, OrchestrationMcpLaunch};

pub trait OrchestrationHooks: Send + Sync {
    /// A credential for one spawn of `chat_id`, revoking the chat's previous
    /// one. `session_id` is the adapter session about to spawn, so a late exit
    /// of a replaced process cannot revoke its successor's credential.
    fn issue_credential(&self, chat_id: &str, session_id: &str) -> Option<OrchestrationMcpLaunch>;
    /// Revokes the chat's credential and cancels its in-flight calls.
    fn revoke_credential(&self, chat_id: &str);
    /// A Stop is starting on `chat_id` (the user's Stop, archive, discard):
    /// cancel its in-flight calls and the work it delegated.
    fn on_chat_stopping<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()>;
    /// Messages Mainframe holds for `chat_id` until it is idle, oldest first.
    fn agent_outbox(&self, chat_id: &str) -> Vec<AgentOutboxEntry>;
}

/// Shared between the `ChatManager` facade and its lifecycle manager.
#[derive(Clone, Default)]
pub struct OrchestrationSlot(Arc<OnceLock<Arc<dyn OrchestrationHooks>>>);

impl OrchestrationSlot {
    /// First attach wins; a stray second attach is a no-op.
    pub fn attach(&self, hooks: Arc<dyn OrchestrationHooks>) {
        let _ = self.0.set(hooks);
    }

    #[must_use]
    pub fn issue(&self, chat_id: &str, session_id: &str) -> Option<OrchestrationMcpLaunch> {
        self.0.get()?.issue_credential(chat_id, session_id)
    }

    pub fn revoke(&self, chat_id: &str) {
        if let Some(hooks) = self.0.get() {
            hooks.revoke_credential(chat_id);
        }
    }

    pub async fn stopping(&self, chat_id: &str) {
        if let Some(hooks) = self.0.get() {
            hooks.on_chat_stopping(chat_id).await;
        }
    }

    #[must_use]
    pub fn agent_outbox(&self, chat_id: &str) -> Vec<AgentOutboxEntry> {
        self.0
            .get()
            .map(|hooks| hooks.agent_outbox(chat_id))
            .unwrap_or_default()
    }
}

#[cfg(test)]
#[path = "orchestration_hooks_tests.rs"]
mod tests;
