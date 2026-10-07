//! `OrchestrationPort` over the live daemon.

use std::sync::Arc;

use mainframe_adapter_api::AdapterRegistry;
use mainframe_chat::chat_manager::ChatManager;
use mainframe_orchestration::errors::{PortError, cap_chars};
use mainframe_orchestration::ports::{
    AdapterView, BoxFuture, ChatView, LaunchRequest, ModelView, OrchestrationPort,
    PendingPermissionView,
};
use mainframe_types::adapter::ControlRequest;
use mainframe_types::chat::{Chat, ChatMessage, NO_PROJECT_ID, ProcessState};
use mainframe_types::events::DaemonEvent;
use mainframe_types::settings::ExecutionMode;
use tokio::sync::broadcast;

use crate::db::Db;

const PERMISSION_SUMMARY_CHARS: usize = 200;

pub struct DaemonOrchestrationPort {
    pub(super) chats: Arc<ChatManager>,
    pub(super) db: Db,
    adapters: Arc<AdapterRegistry>,
    broadcast: broadcast::Sender<DaemonEvent>,
}

impl DaemonOrchestrationPort {
    pub fn new(
        chats: Arc<ChatManager>,
        db: Db,
        adapters: Arc<AdapterRegistry>,
        broadcast: broadcast::Sender<DaemonEvent>,
    ) -> Self {
        Self {
            chats,
            db,
            adapters,
            broadcast,
        }
    }

    async fn pending_permission(&self, chat_id: &str) -> Option<PendingPermissionView> {
        if !self.chats.has_pending_permission(chat_id) {
            return None;
        }
        let request = self.chats.get_pending_permission(chat_id).await?;
        Some(permission_view(&request))
    }

    pub(super) async fn view(&self, chat: Chat) -> ChatView {
        let pending = self.pending_permission(&chat.id).await;
        let queued = self.chats.queued_message_count(&chat.id);
        chat_view(chat, pending, queued)
    }
}

fn permission_view(request: &ControlRequest) -> PendingPermissionView {
    let input = serde_json::to_string(&request.input).unwrap_or_default();
    PendingPermissionView {
        tool_name: request.tool_name.clone(),
        summary: cap_chars(&input, PERMISSION_SUMMARY_CHARS),
    }
}

/// The adapter-neutral view. `working` covers a live turn and prompts the
/// CLI still holds in its own queue. Provenance comes off the `Chat` itself.
fn chat_view(chat: Chat, pending: Option<PendingPermissionView>, queued: usize) -> ChatView {
    let working = chat.process_state == Some(Some(ProcessState::Working)) || queued > 0;
    ChatView {
        id: chat.id,
        project_id: chat.project_id,
        title: chat.title,
        adapter_id: chat.adapter_id,
        model: chat.model,
        permission_mode: chat.permission_mode.unwrap_or(ExecutionMode::Default),
        plan_mode: chat.plan_mode.unwrap_or(false),
        status: chat.status,
        working,
        pending_permission: pending,
        temporary: chat.temporary,
        automation: chat.automation_run_id.is_some(),
        parent_chat_id: chat.parent_chat_id.flatten(),
        created_by_chat_id: chat.orchestration.created_by_chat_id,
        task_id: chat.orchestration.delegation.map(|d| d.task_id),
        worktree_path: chat.worktree_path,
        branch_name: chat.branch_name,
        created_at: chat.created_at,
        updated_at: chat.updated_at,
    }
}

impl OrchestrationPort for DaemonOrchestrationPort {
    fn chat<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, Option<ChatView>> {
        Box::pin(async move {
            let chat = self.chats.get_chat(chat_id)?;
            Some(self.view(chat).await)
        })
    }

    fn list_chats<'a>(
        &'a self,
        project_id: &'a str,
        include_archived: bool,
    ) -> BoxFuture<'a, Vec<ChatView>> {
        Box::pin(async move {
            let chats =
                self.chats
                    .list_filtered(Some(project_id), None, false, include_archived, false);
            let mut views = Vec::with_capacity(chats.len());
            for chat in chats {
                views.push(self.view(chat).await);
            }
            views
        })
    }

    fn project_exists<'a>(&'a self, project_id: &'a str) -> BoxFuture<'a, bool> {
        Box::pin(async move {
            if project_id == NO_PROJECT_ID {
                return true;
            }
            let id = project_id.to_string();
            match self.db.call(move |d| d.projects.get(&id)).await {
                Ok(project) => project.is_some(),
                Err(err) => {
                    tracing::warn!(project_id, %err, "failed to read project");
                    false
                }
            }
        })
    }

    fn messages<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, Vec<ChatMessage>> {
        Box::pin(async move { self.chats.get_messages(chat_id).await })
    }

    fn adapters(&self) -> BoxFuture<'_, Vec<AdapterView>> {
        Box::pin(async move {
            let infos = self.adapters.list().await;
            infos
                .into_iter()
                .map(|info| AdapterView {
                    steer: self
                        .adapters
                        .get(&info.id)
                        .is_some_and(|a| a.supports_steer()),
                    available: info.installed,
                    unavailable_reason: (!info.installed).then(|| "not installed".to_string()),
                    id: info.id,
                    name: info.name,
                    installed: info.installed,
                    models: info
                        .models
                        .into_iter()
                        .map(|m| ModelView {
                            id: m.id,
                            label: m.label,
                        })
                        .collect(),
                })
                .collect()
        })
    }

    fn launch_chat(&self, request: LaunchRequest) -> BoxFuture<'_, Result<ChatView, PortError>> {
        Box::pin(async move { self.launch(request).await })
    }

    fn send<'a>(&'a self, chat_id: &'a str, text: &'a str) -> BoxFuture<'a, Result<(), PortError>> {
        Box::pin(async move {
            self.chats
                .send_message(chat_id, text, None, None)
                .await
                .map_err(|err| PortError::Internal(err.to_string()))
        })
    }

    fn steer<'a>(
        &'a self,
        chat_id: &'a str,
        text: &'a str,
    ) -> BoxFuture<'a, Result<(), PortError>> {
        Box::pin(async move {
            self.chats
                .steer_message(chat_id, text)
                .await
                .map_err(|err| PortError::Internal(err.to_string()))
        })
    }

    fn interrupt<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async move { self.chats.interrupt_chat(chat_id).await })
    }

    fn subscribe(&self) -> broadcast::Receiver<DaemonEvent> {
        self.broadcast.subscribe()
    }

    fn emit(&self, event: DaemonEvent) {
        // No receivers only means no client is connected; nothing to do.
        let _ = self.broadcast.send(event);
    }

    fn chat_changed(&self, chat_id: &str) {
        self.chats.refresh_agent_lineage(chat_id);
    }
}
