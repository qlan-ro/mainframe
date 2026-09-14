//! Production `PromptPort`/`ResumePort` over the live `ChatManager` (todo
//! #350, live-wiring pass) — the impls the port traits' docs in
//! `mainframe-acp` promise: `send_prompt` → `ChatManager::send_message`,
//! `cancel` → `interrupt_chat` (which ends the turn cancelled and clears open
//! gates), `resume_snapshot` → `get_resume_snapshot`.

use std::sync::Arc;

use mainframe_acp::prompt::{BoxFuture, PromptAcceptance, PromptError, PromptPort};
use mainframe_acp::resume::ResumePort;
use mainframe_chat::chat_manager::{ChatManager, CommandMeta};
use mainframe_chat::permission_handler::PermissionError;
use mainframe_types::acp::extensions::PromptSendMeta;
use mainframe_types::adapter::{ControlRequest, ControlResponse};
use mainframe_types::display::DisplayMessage;

#[derive(Clone)]
pub struct ManagerPorts {
    manager: Option<Arc<ChatManager>>,
}

impl ManagerPorts {
    pub fn new(manager: Option<Arc<ChatManager>>) -> Self {
        Self { manager }
    }

    fn require(&self) -> Result<&Arc<ChatManager>, PromptError> {
        self.manager.as_ref().ok_or_else(|| PromptError {
            message: "chat manager unavailable".to_string(),
        })
    }
}

impl PromptPort for ManagerPorts {
    fn send_prompt<'a>(
        &'a self,
        session_id: &'a str,
        text: &'a str,
        send_meta: PromptSendMeta,
    ) -> BoxFuture<'a, Result<PromptAcceptance, PromptError>> {
        Box::pin(async move {
            let manager = self.require()?;
            let command = send_meta.command.map(|c| CommandMeta {
                name: c.name,
                source: c.source,
                args: c.args,
            });
            manager
                .send_message(
                    session_id,
                    text,
                    send_meta.attachment_ids.as_deref(),
                    command,
                )
                .await
                .map_err(|err| PromptError {
                    message: err.to_string(),
                })?;
            let queued = manager.queued_message_count(session_id);
            Ok(PromptAcceptance {
                queued_position: (queued > 0).then_some(queued as i64),
            })
        })
    }

    fn cancel<'a>(&'a self, session_id: &'a str) -> BoxFuture<'a, Result<(), PromptError>> {
        Box::pin(async move {
            self.require()?.interrupt_chat(session_id).await;
            Ok(())
        })
    }
}

impl ResumePort for ManagerPorts {
    fn resume_snapshot<'a>(
        &'a self,
        session_id: &'a str,
    ) -> mainframe_acp::resume::BoxFuture<'a, (Vec<DisplayMessage>, Option<ControlRequest>)> {
        Box::pin(async move {
            match &self.manager {
                Some(manager) => manager.get_resume_snapshot(session_id).await,
                None => (Vec::new(), None),
            }
        })
    }

    fn is_running(&self, session_id: &str) -> bool {
        self.manager
            .as_ref()
            .is_some_and(|manager| manager.is_chat_working(session_id))
    }
}

/// The gate-apply seam: kept a plain trait, not a direct `ChatManager` call,
/// so `apply_gate_answer` can be driven by a failing double in tests without
/// spinning up a real session (T3).
pub trait GatePort: Send + Sync {
    fn respond_to_permission<'a>(
        &'a self,
        chat_id: &'a str,
        response: ControlResponse,
    ) -> BoxFuture<'a, Result<(), PermissionError>>;
}

impl GatePort for ManagerPorts {
    fn respond_to_permission<'a>(
        &'a self,
        chat_id: &'a str,
        response: ControlResponse,
    ) -> BoxFuture<'a, Result<(), PermissionError>> {
        Box::pin(async move {
            match &self.manager {
                Some(manager) => manager.respond_to_permission(chat_id, response).await,
                None => Err(PermissionError::Message(
                    "chat manager unavailable".to_string(),
                )),
            }
        })
    }
}
