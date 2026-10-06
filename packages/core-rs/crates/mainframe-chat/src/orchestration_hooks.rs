//! The chat layer's view of the orchestration MCP server. This crate cannot
//! depend on `mainframe-orchestration` (it sits above the chat layer), so the
//! daemon attaches an implementation after both exist, the same post-build
//! pattern as the chat surface. A manager with nothing attached (every test
//! harness) spawns chats without the tools.

use std::sync::{Arc, OnceLock};

use mainframe_adapter_api::BoxFuture;
use mainframe_types::orchestration::OrchestrationMcpLaunch;

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
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use mainframe_types::orchestration::SecretToken;

    use super::*;

    #[derive(Default)]
    struct Recorder {
        calls: Mutex<Vec<String>>,
    }

    impl OrchestrationHooks for Recorder {
        fn issue_credential(
            &self,
            chat_id: &str,
            session_id: &str,
        ) -> Option<OrchestrationMcpLaunch> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("issue {chat_id} {session_id}"));
            Some(OrchestrationMcpLaunch {
                url: "http://127.0.0.1:1/mcp".into(),
                token: SecretToken::new("t".into()),
            })
        }
        fn revoke_credential(&self, chat_id: &str) {
            self.calls.lock().unwrap().push(format!("revoke {chat_id}"));
        }
        fn on_chat_stopping<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()> {
            Box::pin(async move {
                self.calls.lock().unwrap().push(format!("stop {chat_id}"));
            })
        }
    }

    #[tokio::test]
    async fn an_empty_slot_is_inert_and_an_attached_one_forwards() {
        let slot = OrchestrationSlot::default();
        assert!(slot.issue("c", "s").is_none());
        slot.revoke("c");
        slot.stopping("c").await;

        let recorder = Arc::new(Recorder::default());
        slot.attach(recorder.clone());
        assert!(slot.issue("c", "s").is_some());
        slot.revoke("c");
        slot.stopping("c").await;
        let calls = recorder.calls.lock().unwrap().clone();
        assert_eq!(calls, vec!["issue c s", "revoke c", "stop c"]);
    }
}
