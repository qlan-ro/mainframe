//! Where `respond_to_permission` lands once its guards pass: a chat with no
//! live session (start it, then forward), plan mode's clear-context
//! escalation, and the normal forward-and-shift path. Split out of
//! `permission_handler.rs` — a pure move.

use mainframe_types::chat_patch::ChatPatch;
use mainframe_types::sync::LockExt as _;
use std::sync::{Arc, Mutex};

use mainframe_types::adapter::{ControlBehavior, ControlResponse};
use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, ProcessState};
use mainframe_types::content::LeafContent;
use mainframe_types::events::DaemonEvent;

use crate::chat_surface::ChatSurfaceEvent;
use crate::types::ActiveChat;

use super::{ChatPermissionHandler, PermissionError, is_exit_plan_mode};

impl ChatPermissionHandler {
    pub(super) async fn handle_no_session_permission(
        &self,
        chat_id: &str,
        response: ControlResponse,
        active: Option<Arc<Mutex<ActiveChat>>>,
    ) -> Result<(), PermissionError> {
        self.shared.permissions.lock_recover().clear(chat_id);

        if response.behavior == ControlBehavior::Allow
            && is_exit_plan_mode(&response)
            && let Some(active) = &active
        {
            self.plan_mode.handle_no_process(active, &response)?;
        }

        self.lifecycle.start_chat(chat_id).await;

        if let Some(started) = self.shared.active(chat_id)
            && Self::session_spawned(&started)
        {
            let chat = {
                let mut guard = started.lock_recover();
                guard.chat.process_state = Some(Some(ProcessState::Working));
                guard.chat.clone()
            };
            self.shared.update_and_emit(
                chat,
                &ChatPatch {
                    process_state: Some(Some(ProcessState::Working)),
                    ..Default::default()
                },
            )?;
            let session = started.lock_recover().session.clone();
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
        self.plan_mode
            .handle_clear_context(chat_id, &active, response)
            .await?;
        Ok(())
    }

    pub(super) async fn handle_normal_permission(
        &self,
        chat_id: &str,
        active: Arc<Mutex<ActiveChat>>,
        response: ControlResponse,
    ) -> Result<(), PermissionError> {
        let session = active.lock_recover().session.clone();
        let Some(session) = session else {
            return Err(PermissionError::NoSession(chat_id.to_string()));
        };

        session.respond_to_permission(response.clone()).await?;

        // Resolve the gate on the chat-surface seam: the facade's gate registry
        // clears the SAME request for every attached connection.
        self.notify_surface(ChatSurfaceEvent::GateResolved {
            chat_id: chat_id.to_string(),
            request_id: response.request_id.clone(),
        });

        let next_request = self
            .shared
            .permissions
            .lock_recover()
            .shift(chat_id, &response.request_id);
        if let Some(next_request) = next_request {
            self.notify_surface(ChatSurfaceEvent::GateRaised {
                chat_id: chat_id.to_string(),
                request: next_request.clone(),
            });
            self.shared
                .permission_push(chat_id, &next_request.tool_name);
        }

        let chat = active.lock_recover().chat.clone();
        self.shared
            .emit(DaemonEvent::ChatUpdated { chat, reason: None });

        if response.behavior == ControlBehavior::Allow && is_exit_plan_mode(&response) {
            self.plan_mode
                .handle_escalation(chat_id, &active, response)
                .await?;
        }
        Ok(())
    }

    pub(super) fn transient_user_text(&self, chat_id: &str, text: &str) -> ChatMessage {
        self.shared
            .messages
            .lock_recover()
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
