//! Where `respond_to_permission` lands once its guards pass: a chat with no
//! live session (start it, then forward), plan mode's clear-context
//! escalation, and the normal forward-and-shift path. Split out of
//! `permission_handler.rs` (todo #350, PR #688 review) — a pure move.

use std::sync::{Arc, Mutex};

use mainframe_types::adapter::{ControlBehavior, ControlResponse};
use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, ProcessState};
use mainframe_types::content::LeafContent;
use mainframe_types::events::DaemonEvent;

use crate::chat_surface::ChatSurfaceEvent;
use crate::event_handler::{EventChatUpdate, PushOut};
use crate::types::ActiveChat;

use super::{ChatPermissionHandler, PermissionError, PermissionHandlerDeps, is_exit_plan_mode};

impl<D: PermissionHandlerDeps> ChatPermissionHandler<D> {
    pub(super) async fn handle_no_session_permission(
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

    pub(super) async fn handle_clear_context_permission(
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

    pub(super) async fn handle_normal_permission(
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

        // Resolve the gate on the chat-surface seam (todo #350, plan task 17):
        // the facade's gate registry clears the SAME request for every
        // attached connection.
        self.notify_surface(ChatSurfaceEvent::GateResolved {
            chat_id: chat_id.to_string(),
            request_id: response.request_id.clone(),
        });

        let next_request = self
            .permissions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .shift(chat_id, &response.request_id);
        if let Some(next_request) = next_request {
            let notify = self
                .deps
                .should_notify_permission(Some(&next_request.tool_name));
            self.notify_surface(ChatSurfaceEvent::GateRaised {
                chat_id: chat_id.to_string(),
                request: next_request.clone(),
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

    pub(super) fn transient_user_text(&self, chat_id: &str, text: &str) -> ChatMessage {
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
