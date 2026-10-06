//! `OrchestrationPort` over the live daemon.

use std::collections::HashMap;
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

    async fn created_by(&self, chat_id: &str) -> Option<String> {
        let id = chat_id.to_string();
        match self.db.call(move |d| d.chats.created_by(&id)).await {
            Ok(creator) => creator,
            Err(err) => {
                tracing::warn!(chat_id, %err, "failed to read chat provenance");
                None
            }
        }
    }

    async fn created_by_in_project(&self, project_id: &str) -> HashMap<String, String> {
        let id = project_id.to_string();
        match self
            .db
            .call(move |d| d.chats.created_by_in_project(&id))
            .await
        {
            Ok(map) => map,
            Err(err) => {
                tracing::warn!(project_id, %err, "failed to read chat provenance");
                HashMap::new()
            }
        }
    }

    async fn task_id(&self, chat_id: &str) -> Option<String> {
        let id = chat_id.to_string();
        match self
            .db
            .call(move |d| d.delegated_tasks.get_by_child(&id))
            .await
        {
            Ok(task) => task.map(|t| t.id),
            Err(err) => {
                tracing::warn!(chat_id, %err, "failed to read the chat's task");
                None
            }
        }
    }

    async fn task_ids_in_project(&self, project_id: &str) -> HashMap<String, String> {
        let id = project_id.to_string();
        match self
            .db
            .call(move |d| d.delegated_tasks.task_ids_in_project(&id))
            .await
        {
            Ok(map) => map,
            Err(err) => {
                tracing::warn!(project_id, %err, "failed to read delegated tasks");
                HashMap::new()
            }
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
        let lineage = Lineage {
            created_by: self.created_by(&chat.id).await,
            task_id: self.task_id(&chat.id).await,
        };
        let pending = self.pending_permission(&chat.id).await;
        let queued = self.chats.queued_message_count(&chat.id);
        chat_view(chat, lineage, pending, queued)
    }
}

fn permission_view(request: &ControlRequest) -> PendingPermissionView {
    let input = serde_json::to_string(&request.input).unwrap_or_default();
    PendingPermissionView {
        tool_name: request.tool_name.clone(),
        summary: cap_chars(&input, PERMISSION_SUMMARY_CHARS),
    }
}

/// Agent provenance read alongside a chat row.
struct Lineage {
    created_by: Option<String>,
    task_id: Option<String>,
}

/// The adapter-neutral view. `working` covers a live turn and prompts the
/// CLI still holds in its own queue.
fn chat_view(
    chat: Chat,
    lineage: Lineage,
    pending: Option<PendingPermissionView>,
    queued: usize,
) -> ChatView {
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
        created_by_chat_id: lineage.created_by,
        task_id: lineage.task_id,
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
            let creators = self.created_by_in_project(project_id).await;
            let task_ids = self.task_ids_in_project(project_id).await;
            let chats =
                self.chats
                    .list_filtered(Some(project_id), None, false, include_archived, false);
            let mut views = Vec::with_capacity(chats.len());
            for chat in chats {
                let pending = self.pending_permission(&chat.id).await;
                let queued = self.chats.queued_message_count(&chat.id);
                let lineage = Lineage {
                    created_by: creators.get(&chat.id).cloned(),
                    task_id: task_ids.get(&chat.id).cloned(),
                };
                views.push(chat_view(chat, lineage, pending, queued));
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
            self.adapters
                .list()
                .await
                .into_iter()
                .map(|info| AdapterView {
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
                    // No adapter folds a message into a running turn yet;
                    // `chat_send` answers `not_steerable` and agents queue.
                    steer: false,
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
        _text: &'a str,
    ) -> BoxFuture<'a, Result<(), PortError>> {
        Box::pin(async move {
            Err(PortError::Internal(format!(
                "steer requested for {chat_id}, but no adapter reports steer support"
            )))
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
}
