//! Production `PromptPort`/`ResumePort` over the live `ChatManager` — the impls
//! the port traits' docs in `mainframe-acp` promise: `send_prompt` →
//! `ChatManager::send_message`, `cancel` → `interrupt_chat` (which ends the
//! turn cancelled and clears open gates), `resume_snapshot` →
//! `get_resume_snapshot`.

use std::sync::Arc;

use mainframe_acp::prompt::{BoxFuture, PromptAcceptance, PromptError, PromptPort};
use mainframe_acp::resume::{ResumePort, ResumeSnapshot};
use mainframe_adapter_api::AdapterError;
use mainframe_chat::chat_manager::{ChatManager, CommandMeta, SendError};
use mainframe_chat::permission_handler::PermissionError;
use mainframe_types::acp::extensions::{PromptRemedy, PromptSendMeta};
use mainframe_types::adapter::ControlResponse;

#[derive(Clone)]
pub struct ManagerPorts {
    manager: Option<Arc<ChatManager>>,
}

impl ManagerPorts {
    pub fn new(manager: Option<Arc<ChatManager>>) -> Self {
        Self { manager }
    }

    fn require(&self) -> Result<&Arc<ChatManager>, PromptError> {
        self.manager
            .as_ref()
            .ok_or_else(|| PromptError::new("chat manager unavailable"))
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
            if send_meta.wants_steer()
                && let Some(acceptance) = steer_prompt(manager, session_id, text).await?
            {
                return Ok(acceptance);
            }
            let command = send_meta.command.map(|c| CommandMeta {
                name: c.name,
                source: c.source,
                args: c.args,
            });
            let queued_message_id = manager
                .send_message_with_queue_id(
                    session_id,
                    text,
                    send_meta.attachment_ids.as_deref(),
                    command,
                )
                .await
                .map_err(prompt_error)?;
            Ok(PromptAcceptance {
                queued_position: queued_message_id
                    .as_ref()
                    .map(|_| manager.queued_message_count(session_id).max(1) as i64),
                queued_message_id,
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

/// Folds a prompt into the running turn. `None` when it cannot be steered (the
/// turn just ended, or the adapter has no steer): the caller then sends it the
/// ordinary way, which queues it behind a running turn.
async fn steer_prompt(
    manager: &ChatManager,
    chat_id: &str,
    text: &str,
) -> Result<Option<PromptAcceptance>, PromptError> {
    if let Err(error) = manager.steer_message(chat_id, text).await {
        steer_fallback(&error)?;
        tracing::debug!(chat_id, error = %error, "steer unavailable, queueing instead");
        return Ok(None);
    }
    let queued = manager.queued_message_count(chat_id);
    Ok(Some(PromptAcceptance {
        queued_position: (queued > 0).then_some(queued as i64),
        queued_message_id: None,
    }))
}

/// Whether a failed steer may be sent the ordinary way. Only when it certainly
/// never reached the agent: otherwise resending could deliver it twice, so the
/// user is told instead.
fn steer_fallback(error: &SendError) -> Result<(), PromptError> {
    if error.never_delivered() {
        return Ok(());
    }
    Err(PromptError::new(format!(
        "Could not confirm that the agent received this message ({error}). Check the conversation before sending it again."
    )))
}

impl ResumePort for ManagerPorts {
    fn read_snapshot<'a>(
        &'a self,
        session_id: &'a str,
        read: mainframe_acp::resume::SnapshotReader<'a>,
    ) -> mainframe_acp::resume::BoxFuture<
        'a,
        (
            mainframe_types::acp::jsonrpc::JsonRpcResponse,
            mainframe_acp::ResumeReplay,
        ),
    > {
        Box::pin(async move {
            match &self.manager {
                Some(manager) => manager.read_resume_snapshot(session_id, read).await,
                None => read(&[], None, None),
            }
        })
    }

    fn read_messages<'a>(
        &'a self,
        session_id: &'a str,
        read: mainframe_acp::resume::MessageReader<'a>,
    ) -> mainframe_acp::resume::BoxFuture<'a, ()> {
        Box::pin(async move {
            match &self.manager {
                Some(manager) => {
                    manager
                        .read_resume_snapshot(session_id, |messages, _, _| read(messages))
                        .await
                }
                None => read(&[]),
            }
        })
    }

    fn resume_snapshot<'a>(
        &'a self,
        session_id: &'a str,
    ) -> mainframe_acp::resume::BoxFuture<'a, ResumeSnapshot> {
        Box::pin(async move {
            match &self.manager {
                Some(manager) => {
                    let snapshot = manager.get_resume_snapshot(session_id).await;
                    ResumeSnapshot {
                        messages: snapshot.messages,
                        streaming: snapshot.streaming,
                        pending: snapshot.pending,
                    }
                }
                None => ResumeSnapshot {
                    messages: Vec::new(),
                    streaming: None,
                    pending: None,
                },
            }
        })
    }

    fn is_running(&self, session_id: &str) -> bool {
        self.manager
            .as_ref()
            .is_some_and(|manager| manager.is_chat_working(session_id))
    }

    fn turn_started_at_ms(&self, session_id: &str) -> Option<i64> {
        self.manager
            .as_ref()
            .and_then(|manager| manager.turn_started_at_ms(session_id))
    }
}

/// The gate-apply seam: kept a plain trait, not a direct `ChatManager` call,
/// so `apply_gate_answer` can be driven by a failing double in tests without
/// spinning up a real session.
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
                None => Err(PermissionError::ManagerUnavailable),
            }
        })
    }
}

/// A refused send's text, plus the remedy the client can offer for it.
fn prompt_error(err: SendError) -> PromptError {
    let remedy = matches!(
        err,
        SendError::Adapter(AdapterError::NativeSessionArchived(_))
    )
    .then_some(PromptRemedy::UnarchiveNativeSession);
    PromptError {
        message: err.to_string(),
        remedy,
        never_delivered: err.never_delivered(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_refusal_says_whether_the_agent_certainly_did_not_get_the_prompt() {
        let refused = [
            SendError::NotRunning("c1".into()),
            SendError::HandoffTooLarge("Codex".into()),
            SendError::Adapter(AdapterError::DeliveryRejected("no such thread".into())),
            SendError::Adapter(AdapterError::ProjectDirMissing("gone".into())),
            SendError::Adapter(AdapterError::NativeSessionArchived("archived".into())),
        ];
        for error in refused {
            assert!(prompt_error(error).never_delivered);
        }
        let unanswered = SendError::Adapter(AdapterError::Message("timed out".into()));
        assert!(!prompt_error(unanswered).never_delivered);
    }

    #[test]
    fn a_steer_is_resent_only_when_it_never_reached_the_agent() {
        let refused = [
            SendError::NoActiveTurn("c1".into()),
            SendError::SteerUnsupported("c1".into()),
            SendError::NotRunning("c1".into()),
            SendError::Adapter(AdapterError::DeliveryRejected("turn ended".into())),
            SendError::Adapter(AdapterError::StdinFull("s1".into())),
        ];
        for error in refused {
            assert!(steer_fallback(&error).is_ok(), "{error}");
        }
        let unknown = SendError::Adapter(AdapterError::Message("timed out".into()));
        let told = steer_fallback(&unknown).unwrap_err();
        assert!(
            told.message.contains("Check the conversation"),
            "{}",
            told.message
        );
        assert!(told.message.contains("timed out"));
    }
}
