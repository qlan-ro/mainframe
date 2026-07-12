//! `AgentPort` over the ChatManager seam: start a chat, watch the broadcast
//! for its terminal `chat.updated`, read the final assistant text.

use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};

use mainframe_automations::engine::BoxFuture;
use mainframe_automations::ports::{
    AgentHandle, AgentOutcome, AgentPort, AgentPortError, AgentRequest,
};
use mainframe_types::events::{ChatUpdatedReason, DaemonEvent};
use tokio::sync::broadcast;

use crate::ctx::GitFactory;
use crate::db::Db;

use super::chat_port::AgentChatPort;

pub struct DaemonAgentPort {
    chats: Arc<dyn AgentChatPort>,
    broadcast: broadcast::Sender<DaemonEvent>,
    db: Db,
    git: GitFactory,
    /// Receivers subscribed BEFORE the prompt send, so a session that
    /// finishes instantly cannot slip between send and the watch call.
    pending: StdMutex<HashMap<String, broadcast::Receiver<DaemonEvent>>>,
}

impl DaemonAgentPort {
    pub fn new(
        chats: Arc<dyn AgentChatPort>,
        broadcast: broadcast::Sender<DaemonEvent>,
        db: Db,
        git: GitFactory,
    ) -> Self {
        Self {
            chats,
            broadcast,
            db,
            git,
            pending: StdMutex::new(HashMap::new()),
        }
    }

    async fn resolve_project_id(&self, requested: Option<&str>) -> Result<String, AgentPortError> {
        if let Some(id) = requested {
            return Ok(id.to_string());
        }
        let first = self
            .db
            .call(|d| Ok(d.projects.list()?.into_iter().next().map(|p| p.id)))
            .await
            .ok()
            .flatten();
        first.ok_or_else(|| {
            AgentPortError(
                "ask_agent step requires a projectId — either set `projectId` on the step or \
                 ensure at least one project exists in the workspace"
                    .to_string(),
            )
        })
    }

    /// Step-provided base branch, else the project's current branch.
    async fn resolve_base_branch(
        &self,
        project_id: &str,
        requested: Option<&str>,
    ) -> Result<String, AgentPortError> {
        if let Some(base) = requested.filter(|s| !s.is_empty()) {
            return Ok(base.to_string());
        }
        let id = project_id.to_string();
        let path = self
            .db
            .call(move |d| Ok(d.projects.get(&id)?.map(|p| p.path)))
            .await
            .ok()
            .flatten()
            .ok_or_else(|| AgentPortError(format!("project not found: {project_id}")))?;
        self.git
            .for_project(path)
            .current_branch()
            .await
            .map_err(|err| AgentPortError(format!("cannot resolve a base branch: {err}")))
    }

    fn take_receiver(&self, chat_id: &str) -> broadcast::Receiver<DaemonEvent> {
        let taken = self
            .pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(chat_id);
        taken.unwrap_or_else(|| self.broadcast.subscribe())
    }

    async fn wait_terminal(
        &self,
        chat_id: &str,
        mut rx: broadcast::Receiver<DaemonEvent>,
    ) -> Result<AgentOutcome, AgentPortError> {
        loop {
            match rx.recv().await {
                Ok(DaemonEvent::ChatUpdated {
                    chat,
                    reason: Some(reason),
                }) if chat.id == chat_id => {
                    return Ok(match reason {
                        ChatUpdatedReason::Completed => AgentOutcome::Completed {
                            final_text: self.chats.last_assistant_text(chat_id).await,
                        },
                        ChatUpdatedReason::Error => AgentOutcome::Errored,
                        ChatUpdatedReason::Interrupted => AgentOutcome::Interrupted,
                    });
                }
                Ok(_) => {}
                Err(broadcast::error::RecvError::Lagged(missed)) => {
                    // A terminal frame may be among the dropped ones; the
                    // deadline sweep is the backstop for a hung wait.
                    tracing::warn!(chat_id, missed, "agent watch lagged on the event bus");
                }
                Err(broadcast::error::RecvError::Closed) => {
                    return Err(AgentPortError("daemon event stream closed".to_string()));
                }
            }
        }
    }
}

impl AgentPort for DaemonAgentPort {
    fn start(&self, request: AgentRequest) -> BoxFuture<'_, Result<AgentHandle, AgentPortError>> {
        Box::pin(async move {
            let project_id = self
                .resolve_project_id(request.project_id.as_deref())
                .await?;
            if request.auto_approve.as_ref().is_some_and(|a| !a.is_empty()) {
                // R6: no ChatManager parameter exists yet — loud, never silent.
                tracing::warn!(
                    "ask_agent auto-approve scope is not supported by the chat manager yet (R6); option ignored"
                );
            }
            if !request.attachments.is_empty() {
                tracing::warn!(
                    "ask_agent attachments have no storage path yet (A9 authoring-only); ignored"
                );
            }

            let branch_name = request.worktree.as_ref().map(|w| w.branch_name.as_str());
            let chat_id = self
                .chats
                .create_chat(
                    &project_id,
                    &request.adapter_id,
                    request.model.as_deref(),
                    request.permission_mode.as_deref(),
                    branch_name,
                )
                .await;

            if let Some(worktree) = &request.worktree {
                let base = self
                    .resolve_base_branch(&project_id, worktree.base_branch.as_deref())
                    .await?;
                self.chats
                    .enable_worktree(&chat_id, &base, &worktree.branch_name)
                    .await
                    .map_err(AgentPortError)?;
            }

            // Subscribe BEFORE the send so the terminal event cannot race the
            // upcoming watch() call.
            self.pending
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(chat_id.clone(), self.broadcast.subscribe());

            if let Err(err) = self.chats.send_message(&chat_id, &request.prompt).await {
                self.pending
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&chat_id);
                return Err(AgentPortError(err));
            }
            Ok(AgentHandle { chat_id })
        })
    }

    fn watch<'a>(
        &'a self,
        chat_id: &'a str,
    ) -> BoxFuture<'a, Result<AgentOutcome, AgentPortError>> {
        Box::pin(async move {
            let rx = self.take_receiver(chat_id);
            self.wait_terminal(chat_id, rx).await
        })
    }

    fn retry<'a>(
        &'a self,
        chat_id: &'a str,
        correction: &'a str,
    ) -> BoxFuture<'a, Result<AgentOutcome, AgentPortError>> {
        Box::pin(async move {
            let rx = self.broadcast.subscribe();
            self.chats
                .send_message(chat_id, correction)
                .await
                .map_err(AgentPortError)?;
            self.wait_terminal(chat_id, rx).await
        })
    }

    fn cancel<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, Result<(), AgentPortError>> {
        Box::pin(async move {
            self.chats.interrupt(chat_id).await;
            Ok(())
        })
    }
}

// PORT STATUS: packages/core/src/automations/agent-port.ts +
// verbs/agent-waits.ts onChatFinished (the watch loop folds the wait table
// into a future — Rust durable-wait design, T4.3)
// confidence: high
// todos: 0
// notes: worktree base branch defaults to the project's current branch when
//        the step omits baseBranch (the enable-worktree route requires an
//        explicit base; an automation has no UI picker to supply one).
