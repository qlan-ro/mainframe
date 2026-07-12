//! Ported from `packages/core/src/chat/permission-handler.ts`.

use std::sync::{Arc, Mutex};

use mainframe_adapter_api::{AdapterError, BoxFuture};
use mainframe_types::adapter::{ControlBehavior, ControlRequest, ControlResponse};
use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, ProcessState};
use mainframe_types::content::LeafContent;
use mainframe_types::events::DaemonEvent;
use tracing::{info, warn};

use crate::event_handler::{EventChatUpdate, PushOut};
use crate::message_cache::MessageCache;
use crate::permission_manager::PermissionManager;
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

pub struct ChatPermissionHandler<D: PermissionHandlerDeps> {
    permissions: Arc<Mutex<PermissionManager>>,
    messages: Arc<Mutex<MessageCache>>,
    deps: D,
}

fn is_exit_plan_mode(response: &ControlResponse) -> bool {
    response.tool_name.as_deref() == Some("ExitPlanMode")
}

impl<D: PermissionHandlerDeps> ChatPermissionHandler<D> {
    pub fn new(
        permissions: Arc<Mutex<PermissionManager>>,
        messages: Arc<Mutex<MessageCache>>,
        deps: D,
    ) -> Self {
        Self {
            permissions,
            messages,
            deps,
        }
    }

    fn has_pending(&self, chat_id: &str) -> bool {
        self.permissions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .has_pending(chat_id)
    }

    fn session_spawned(cell: &Arc<Mutex<ActiveChat>>) -> bool {
        cell.lock()
            .unwrap_or_else(|e| e.into_inner())
            .session
            .as_ref()
            .is_some_and(|s| s.is_spawned())
    }

    pub async fn respond_to_permission(
        &self,
        chat_id: &str,
        response: ControlResponse,
    ) -> Result<(), PermissionError> {
        let active = self.deps.get_active_chat(chat_id);

        // Guard: reject stale/duplicate responses (only when a permission is queued).
        if let Some(cell) = &active {
            let matches_pending = self
                .permissions
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .matches_pending(chat_id, &response.request_id);
            if Self::session_spawned(cell) && self.has_pending(chat_id) && !matches_pending {
                warn!(
                    chat_id,
                    request_id = response.request_id,
                    "respondToPermission: requestId does not match pending, ignoring stale response"
                );
                return Ok(());
            }
        }

        let spawned = active.as_ref().is_some_and(Self::session_spawned);
        if !spawned {
            warn!(
                chat_id,
                request_id = response.request_id,
                tool_name = ?response.tool_name,
                behavior = ?response.behavior,
                "respondToPermission: no active session, will start fresh"
            );
            return self
                .handle_no_session_permission(chat_id, response, active)
                .await;
        }
        let Some(active) = active else {
            return Ok(()); // `spawned` implies `Some`; defensive early-out
        };

        info!(
            chat_id,
            request_id = response.request_id,
            tool_name = ?response.tool_name,
            behavior = ?response.behavior,
            "respondToPermission: forwarding to session"
        );

        if let Some(text) = &response.message {
            let message = self.transient_user_text(chat_id, text);
            self.messages
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .append(chat_id, message.clone());
            self.deps.emit_event(DaemonEvent::MessageAdded {
                chat_id: chat_id.to_string(),
                message,
            });
            self.deps.emit_display(chat_id);
        }

        if response.clear_context == Some(true)
            && response.behavior == ControlBehavior::Allow
            && is_exit_plan_mode(&response)
        {
            return self
                .handle_clear_context_permission(chat_id, active, response)
                .await;
        }

        self.handle_normal_permission(chat_id, active, response)
            .await
    }

    pub async fn get_pending_permission(&self, chat_id: &str) -> Option<ControlRequest> {
        if !self.has_pending(chat_id) {
            let _ = self.deps.get_messages(chat_id).await;
        }
        self.permissions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get_pending(chat_id)
            .cloned()
    }

    pub fn has_pending_permission(&self, chat_id: &str) -> bool {
        self.has_pending(chat_id)
    }

    pub fn clear_pending_permission(&self, chat_id: &str) {
        self.permissions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear(chat_id);
    }

    async fn handle_no_session_permission(
        &self,
        chat_id: &str,
        response: ControlResponse,
        active: Option<Arc<Mutex<ActiveChat>>>,
    ) -> Result<(), PermissionError> {
        self.permissions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear(chat_id);

        if response.behavior == ControlBehavior::Allow
            && is_exit_plan_mode(&response)
            && let Some(active) = &active
        {
            self.deps
                .plan_mode_handle_no_process(chat_id, active, &response);
        }

        self.deps.start_chat(chat_id).await;

        if let Some(started) = self.deps.get_active_chat(chat_id)
            && Self::session_spawned(&started)
        {
            let chat = {
                let mut guard = started.lock().unwrap_or_else(|e| e.into_inner());
                guard.chat.process_state = Some(Some(ProcessState::Working));
                guard.chat.clone()
            };
            self.deps.chats_update(
                chat_id,
                &EventChatUpdate {
                    process_state: Some(Some(ProcessState::Working)),
                    ..Default::default()
                },
            );
            self.deps
                .emit_event(DaemonEvent::ChatUpdated { chat, reason: None });
            let session = started
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .session
                .clone();
            if let Some(session) = session {
                session.respond_to_permission(response).await?;
            }
        }
        Ok(())
    }

    async fn handle_clear_context_permission(
        &self,
        chat_id: &str,
        active: Arc<Mutex<ActiveChat>>,
        response: ControlResponse,
    ) -> Result<(), PermissionError> {
        self.deps
            .plan_mode_handle_clear_context(chat_id, active, response)
            .await?;
        Ok(())
    }

    async fn handle_normal_permission(
        &self,
        chat_id: &str,
        active: Arc<Mutex<ActiveChat>>,
        response: ControlResponse,
    ) -> Result<(), PermissionError> {
        let session = active
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .session
            .clone();
        let Some(session) = session else {
            return Err(PermissionError::Message(format!(
                "No session for chat {chat_id}"
            )));
        };

        session.respond_to_permission(response.clone()).await?;

        self.deps.emit_event(DaemonEvent::PermissionResolved {
            chat_id: chat_id.to_string(),
            request_id: response.request_id.clone(),
        });

        let next_request = self
            .permissions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .shift(chat_id);
        if let Some(next_request) = next_request {
            let notify = self
                .deps
                .should_notify_permission(Some(&next_request.tool_name));
            self.deps.emit_event(DaemonEvent::PermissionRequested {
                chat_id: chat_id.to_string(),
                request: next_request.clone(),
                notify,
            });
            if notify {
                self.deps.send_push(PushOut {
                    chat_id: chat_id.to_string(),
                    title: "Permission Required".to_string(),
                    body: format!("Agent wants to run: {}", next_request.tool_name),
                    push_type: "permission".to_string(),
                    priority: "high".to_string(),
                });
            }
        }

        let chat = active
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .chat
            .clone();
        self.deps
            .emit_event(DaemonEvent::ChatUpdated { chat, reason: None });

        if response.behavior == ControlBehavior::Allow && is_exit_plan_mode(&response) {
            self.deps
                .plan_mode_handle_escalation(chat_id, active, response)
                .await?;
        }
        Ok(())
    }

    fn transient_user_text(&self, chat_id: &str, text: &str) -> ChatMessage {
        self.messages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .create_transient_message(
                chat_id,
                ChatMessageType::User,
                vec![MessageContent::Leaf(LeafContent::Text {
                    text: text.to_string(),
                    parent_tool_use_id: None,
                })],
                None,
            )
    }
}

// PORT STATUS: src/chat/permission-handler.ts (156 lines)
// confidence: medium
// notes: TS `PermissionHandlerDeps` DI bag → `PermissionHandlerDeps` trait; the
// notes: `permissions`/`messages` PER_ENTITY caches are shared `Arc<Mutex<..>>`
// notes: (the sink task also touches them). `planMode.*` calls become three deps
// notes: methods (handle_no_process sync; clear_context/escalation async) so the
// notes: handler avoids being generic over PlanModeContext; chat_manager forwards
// notes: to its PlanModeHandler. Session I/O (respondToPermission) is cloned out of
// notes: the ActiveChat cell and awaited outside the lock (CONCURRENCY rule 4).
// notes: warn/info strings + the "No session for chat {id}" throw copied verbatim.
// notes: No dedicated TS test file (exercised via chat-manager + plan-mode paths).
// todos: 0
