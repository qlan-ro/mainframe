//! Production `PlanActionContext`/`PlanModeContext` pair (T4). Wires the ported
//! dispatcher in `plan_mode_handler.rs` to `ChatManager`'s private
//! active-chat/message/permission state via the narrow `PlanHost` seam, so this
//! module never names `EhDeps`/`LcDeps` and `chat_manager.rs` stays wiring-only.

use std::sync::{Arc, Mutex};

use dashmap::DashMap;
use mainframe_adapter_api::{
    AdapterError, BoxFuture, PlanActionContext, PlanChatUpdate, PlanModeActionHandler,
};
use mainframe_types::adapter::ControlResponse;
use mainframe_types::events::DaemonEvent;
use mainframe_types::settings::ExecutionMode;

use crate::chat_manager::{ChatManagerDeps, ChatUpdate};
use crate::context_tracker::extract_latest_plan_file_from_messages;
use crate::message_cache::MessageCache;
use crate::permission_manager::PermissionManager;
use crate::plan_mode_handler::PlanModeContext;
use crate::types::ActiveChat;

pub(crate) type PlanRegistry = Arc<DashMap<String, Arc<Mutex<ActiveChat>>>>;

/// The narrow seam back into `ChatManager`'s privately-typed event/lifecycle
/// pieces (`EventHandler<EhDeps>` / `ChatLifecycleManager<LcDeps>`), so this
/// module depends on neither.
pub(crate) trait PlanHost: Send + Sync {
    fn emit_event(&self, event: DaemonEvent);
    fn clear_display_cache(&self, chat_id: &str);
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
    pub(crate) deps: Arc<dyn ChatManagerDeps>,
    pub(crate) active_chats: PlanRegistry,
    pub(crate) messages: Arc<Mutex<MessageCache>>,
    pub(crate) permissions: Arc<Mutex<PermissionManager>>,
    pub(crate) host: Arc<dyn PlanHost>,
}

impl PlanModeContext for ChatPlanModeCtx {
    fn chats_update(&self, chat_id: &str, permission_mode: ExecutionMode, plan_mode: bool) {
        self.deps.chats_update(
            chat_id,
            &ChatUpdate {
                permission_mode: Some(permission_mode),
                plan_mode: Some(plan_mode),
                ..Default::default()
            },
        );
    }
    fn emit_event(&self, event: DaemonEvent) {
        self.host.emit_event(event);
    }
    fn resolve_plan_mode_handler(
        &self,
        adapter_id: &str,
    ) -> Option<Arc<dyn PlanModeActionHandler>> {
        self.deps.create_plan_mode_handler(adapter_id)
    }
    fn action_context(&self, chat_id: &str, request_id: &str) -> Arc<dyn PlanActionContext> {
        Arc::new(ChatPlanActionCtx {
            chat_id: chat_id.to_string(),
            request_id: request_id.to_string(),
            deps: self.deps.clone(),
            active_chats: self.active_chats.clone(),
            messages: self.messages.clone(),
            permissions: self.permissions.clone(),
            host: self.host.clone(),
        })
    }
}

/// `PlanActionContext` over one chat's `ActiveChat` cell — mirrors the TS
/// `buildActionContext(chatId, active)` object bag.
struct ChatPlanActionCtx {
    chat_id: String,
    request_id: String,
    deps: Arc<dyn ChatManagerDeps>,
    active_chats: PlanRegistry,
    messages: Arc<Mutex<MessageCache>>,
    permissions: Arc<Mutex<PermissionManager>>,
    host: Arc<dyn PlanHost>,
}

impl ChatPlanActionCtx {
    fn active(&self) -> Option<Arc<Mutex<ActiveChat>>> {
        self.active_chats
            .get(&self.chat_id)
            .map(|e| e.value().clone())
    }

    fn session(&self) -> Option<Arc<dyn mainframe_adapter_api::AdapterSession>> {
        self.active()
            .and_then(|a| a.lock().unwrap_or_else(|e| e.into_inner()).session.clone())
    }
}

impl PlanActionContext for ChatPlanActionCtx {
    fn chat_id(&self) -> String {
        self.chat_id.clone()
    }

    fn update_chat(&self, patch: PlanChatUpdate) {
        if let Some(active) = self.active() {
            let mut guard = active.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(plan_mode) = patch.plan_mode {
                guard.chat.plan_mode = Some(plan_mode);
            }
            if let Some(mode) = patch.permission_mode {
                guard.chat.permission_mode = Some(mode);
            }
            if patch.clear_claude_session_id {
                guard.chat.claude_session_id = None;
            }
        }
        self.deps.chats_update(
            &self.chat_id,
            &ChatUpdate {
                permission_mode: patch.permission_mode,
                plan_mode: patch.plan_mode,
                ..Default::default()
            },
        );
        if patch.clear_claude_session_id {
            self.deps.chats_clear_session(&self.chat_id);
        }
    }

    fn emit_chat_updated(&self) {
        let chat = self
            .active()
            .map(|a| a.lock().unwrap_or_else(|e| e.into_inner()).chat.clone());
        if let Some(chat) = chat {
            self.host
                .emit_event(DaemonEvent::ChatUpdated { chat, reason: None });
        }
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
            active.lock().unwrap_or_else(|e| e.into_inner()).session = None;
        }
    }

    fn permissions_shift(&self) {
        self.permissions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .shift(&self.chat_id, &self.request_id);
    }

    fn recover_latest_plan_file(&self) -> Option<String> {
        let messages = self.messages.lock().unwrap_or_else(|e| e.into_inner());
        extract_latest_plan_file_from_messages(messages.get(&self.chat_id)?)
    }

    fn add_plan_file(&self, path: String) -> bool {
        self.deps.add_plan_file(&self.chat_id, &path)
    }

    fn clear_messages(&self) {
        self.messages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .set(&self.chat_id, Vec::new());
    }

    fn clear_display_cache(&self) {
        self.host.clear_display_cache(&self.chat_id);
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

// PORT STATUS: src/chat/plan-mode-actions.ts — production context, no direct TS
// counterpart file (the TS `buildActionContext` closure lived inline in
// chat-manager.ts). See plan_mode_handler.rs's PORT STATUS for the handler port.
// confidence: medium
// todos: 0
// notes: `PlanHost` is the Rust-only seam replacing the TS closure's direct
// notes: access to `this.eventHandler`/`this.lifecycle`; ChatManager's PlanHostImpl
// notes: (chat_manager.rs) implements it. Locks are always dropped before an
// notes: awaited call or a deps persist call (CONCURRENCY rules 1-4).
// notes: no emit_display: TS's PlanModeHandler DI bag (chat-manager.ts:95-105)
// notes: never wires it — emitDisplay only reaches ChatPermissionHandler.
