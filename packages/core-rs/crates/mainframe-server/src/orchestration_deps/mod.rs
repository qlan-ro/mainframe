//! Wires the orchestration MCP server (`mainframe-orchestration`) to the
//! daemon: the `OrchestrationPort` over `ChatManager`, the DB, git, and the
//! event broadcast, plus the hooks the chat layer calls on every spawn and
//! teardown.

use std::sync::{Arc, Weak};

use mainframe_adapter_api::{AdapterRegistry, BoxFuture};
use mainframe_chat::chat_manager::ChatManager;
use mainframe_chat::orchestration_hooks::OrchestrationHooks;
use mainframe_orchestration::OrchestrationService;
use mainframe_types::events::DaemonEvent;
use mainframe_types::orchestration::OrchestrationMcpLaunch;
use tokio::sync::broadcast;

use crate::db::Db;

mod chat_port;
mod launch;
mod workspace;

#[cfg(test)]
mod tests;

pub use chat_port::DaemonOrchestrationPort;
pub(crate) use workspace::branch_name_ok;

/// Builds the service and attaches its hooks to the chat manager, so every
/// spawn from here on carries a credential. The caller keeps the returned
/// `Arc` (on `AppCtx`) and starts its event loop.
pub fn build_orchestration(
    chats: Arc<ChatManager>,
    db: Db,
    adapters: Arc<AdapterRegistry>,
    broadcast: broadcast::Sender<DaemonEvent>,
    version: &str,
    daemon_port: u16,
) -> Arc<OrchestrationService> {
    let port = Arc::new(DaemonOrchestrationPort::new(
        Arc::clone(&chats),
        db,
        adapters,
        broadcast,
    ));
    let service = Arc::new(OrchestrationService::new(port, version, daemon_port));
    chats.set_orchestration_hooks(Arc::new(ChatOrchestrationHooks {
        service: Arc::downgrade(&service),
    }));
    service
}

/// The chat layer's handle on the service. Weak, because the service's port
/// already holds the chat manager; a strong edge back would be a cycle.
struct ChatOrchestrationHooks {
    service: Weak<OrchestrationService>,
}

impl OrchestrationHooks for ChatOrchestrationHooks {
    fn issue_credential(&self, chat_id: &str, session_id: &str) -> Option<OrchestrationMcpLaunch> {
        let service = self.service.upgrade()?;
        Some(service.issue_launch(chat_id, session_id))
    }

    fn revoke_credential(&self, chat_id: &str) {
        if let Some(service) = self.service.upgrade() {
            service.revoke(chat_id);
        }
    }

    fn on_chat_stopping<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            if let Some(service) = self.service.upgrade() {
                service.cascade_stop(chat_id, None).await;
            }
        })
    }
}
