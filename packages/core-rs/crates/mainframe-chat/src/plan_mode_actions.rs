//! Plan actions over shared chat state and lifecycle callbacks.

use mainframe_types::chat_patch::ChatPatch;
use mainframe_types::sync::LockExt as _;
use std::sync::{Arc, Mutex};

use mainframe_adapter_api::{
    AdapterError, BoxFuture, PlanActionContext, PlanChatUpdate, PlanModeActionHandler,
};
use mainframe_types::adapter::ControlResponse;
use mainframe_types::events::DaemonEvent;
use mainframe_types::settings::ExecutionMode;

use crate::chat_manager::ChatShared;
use crate::context_tracker::extract_latest_plan_file_from_messages;
use crate::plan_mode_handler::PlanModeContext;
use crate::types::ActiveChat;

pub(crate) trait PlanHost: Send + Sync {
    fn emit_event(&self, event: DaemonEvent);
    fn clear_display_state(&self, chat_id: &str);
    fn notify_transcript_cleared(&self, chat_id: &str);
    fn start_chat<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()>;
    fn send_message<'a>(
        &'a self,
        chat_id: &'a str,
        content: &'a str,
    ) -> BoxFuture<'a, Result<(), AdapterError>>;
}

/// `PlanModeContext` over `ChatManager`'s shared state (relocated `buildActionContext`
/// dependency bag).
pub(crate) struct ChatPlanModeCtx {
    pub(crate) shared: Arc<ChatShared>,
    pub(crate) host: Arc<dyn PlanHost>,
}

impl PlanModeContext for ChatPlanModeCtx {
    fn update_and_emit(
        &self,
        chat: mainframe_types::chat::Chat,
        permission_mode: ExecutionMode,
        plan_mode: bool,
    ) -> Result<(), mainframe_types::seam_error::SeamError> {
        self.shared.update_and_emit(
            chat,
            &ChatPatch {
                permission_mode: Some(permission_mode),
                plan_mode: Some(plan_mode),
                ..Default::default()
            },
        )
    }
    fn resolve_plan_mode_handler(
        &self,
        adapter_id: &str,
    ) -> Option<Arc<dyn PlanModeActionHandler>> {
        self.shared.deps.create_plan_mode_handler(adapter_id)
    }
    fn action_context(&self, chat_id: &str, request_id: &str) -> Arc<dyn PlanActionContext> {
        Arc::new(ChatPlanActionCtx {
            chat_id: chat_id.to_string(),
            request_id: request_id.to_string(),
            shared: self.shared.clone(),
            host: self.host.clone(),
        })
    }
}

/// `PlanActionContext` over one chat's `ActiveChat` cell.
struct ChatPlanActionCtx {
    shared: Arc<ChatShared>,
    chat_id: String,
    request_id: String,
    host: Arc<dyn PlanHost>,
}

impl ChatPlanActionCtx {
    fn active(&self) -> Option<Arc<Mutex<ActiveChat>>> {
        self.shared
            .active_chats
            .get(&self.chat_id)
            .map(|e| e.value().clone())
    }

    fn session(&self) -> Option<Arc<dyn mainframe_adapter_api::AdapterSession>> {
        self.active().and_then(|a| a.lock_recover().session.clone())
    }
}

impl PlanActionContext for ChatPlanActionCtx {
    fn chat_id(&self) -> String {
        self.chat_id.clone()
    }

    fn update_chat(&self, patch: PlanChatUpdate) -> Result<(), AdapterError> {
        let update = self
            .shared
            .prepare_update(
                &self.chat_id,
                &ChatPatch {
                    permission_mode: patch.permission_mode,
                    plan_mode: patch.plan_mode,
                    ..Default::default()
                },
            )
            .map_err(|error| AdapterError::Message(error.to_string()))?;
        if patch.clear_claude_session_id {
            self.shared
                .deps
                .chats_clear_session(&self.chat_id)
                .map_err(|error| AdapterError::Message(error.to_string()))?;
        }
        if let Some(active) = self.active() {
            let mut guard = active.lock_recover();
            if let Some(plan_mode) = patch.plan_mode {
                guard.chat.plan_mode = Some(plan_mode);
            }
            if let Some(mode) = patch.permission_mode {
                guard.chat.permission_mode = Some(mode);
            }
            if patch.clear_claude_session_id {
                guard.chat.claude_session_id = None;
            }
            let chat = guard.chat.clone();
            drop(guard);
            update.emit(chat, None);
        }
        Ok(())
    }

    fn emit_event(&self, event: DaemonEvent) {
        self.host.emit_event(event);
    }

    fn session_is_spawned(&self) -> bool {
        self.session().is_some_and(|s| s.is_spawned())
    }

    fn session_set_permission_mode(
        &self,
        mode: ExecutionMode,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        let session = self.session();
        Box::pin(async move {
            match session {
                Some(session) => session.set_permission_mode(mode).await,
                None => Ok(()),
            }
        })
    }

    fn session_respond_to_permission(
        &self,
        response: ControlResponse,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        let session = self.session();
        Box::pin(async move {
            match session {
                Some(session) => session.respond_to_permission(response).await,
                None => Ok(()),
            }
        })
    }

    fn session_kill(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        let session = self.session();
        Box::pin(async move {
            match session {
                Some(session) => session.kill().await,
                None => Ok(()),
            }
        })
    }

    fn clear_active_session(&self) {
        if let Some(active) = self.active() {
            active.lock_recover().session = None;
        }
    }

    fn permissions_shift(&self) {
        self.shared
            .permissions
            .lock_recover()
            .shift(&self.chat_id, &self.request_id);
    }

    fn recover_latest_plan_file(&self) -> Option<String> {
        let messages = self.shared.messages.lock_recover();
        extract_latest_plan_file_from_messages(messages.get(&self.chat_id)?)
    }

    fn add_plan_file(&self, path: String) -> bool {
        storage_event!(
            self.shared,
            self.shared.deps.add_plan_file(&self.chat_id, &path),
            false
        )
    }

    fn clear_messages(&self) {
        self.shared
            .messages
            .lock_recover()
            .set(&self.chat_id, Vec::new());
    }

    fn clear_display_state(&self) {
        self.host.clear_display_state(&self.chat_id);
    }

    fn notify_transcript_cleared(&self) {
        self.host.notify_transcript_cleared(&self.chat_id);
    }

    fn start_chat(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async move {
            self.host.start_chat(&self.chat_id).await;
            Ok(())
        })
    }

    fn send_message(&self, content: String) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async move { self.host.send_message(&self.chat_id, &content).await })
    }
}

#[cfg(test)]
mod tests;
