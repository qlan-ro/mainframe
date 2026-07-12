//! Ported from `packages/core/src/plugins/services/chat-service.ts`.
//!
//! Maps host `Chat` rows to `ChatSummary` DTOs and, when `chat:create` is
//! declared, creates chats (reading the adapter's provider defaults) and emits
//! `chat.created`.

use std::sync::Arc;

use mainframe_adapter_api::BoxFuture;
use mainframe_types::events::DaemonEvent;
use mainframe_types::plugin::{ChatSummary, PluginCapability, PluginManifest};

use crate::PluginError;
use crate::context::{ChatService, CreateChatArgs, CreateChatResult, EmitSink, PluginHostDb};
use mainframe_types::chat::Chat;

struct HostChatService {
    can_create: bool,
    host_db: Arc<dyn PluginHostDb>,
    emit: EmitSink,
}

/// `buildChatService(manifest, db, emitEvent)`.
pub fn build_chat_service(
    manifest: &PluginManifest,
    host_db: Arc<dyn PluginHostDb>,
    emit: EmitSink,
) -> Arc<dyn ChatService> {
    Arc::new(HostChatService {
        can_create: manifest
            .capabilities
            .contains(&PluginCapability::ChatCreate),
        host_db,
        emit,
    })
}

/// `{ id, title: title ?? null, projectId, adapterId, createdAt, totalCost }`.
fn to_summary(c: &Chat) -> ChatSummary {
    ChatSummary {
        id: c.id.clone(),
        title: c.title.clone(),
        project_id: c.project_id.clone(),
        adapter_id: c.adapter_id.clone(),
        created_at: c.created_at.clone(),
        total_cost: c.total_cost,
    }
}

impl ChatService for HostChatService {
    fn list_chats(&self, project_id: &str) -> BoxFuture<'_, Result<Vec<ChatSummary>, PluginError>> {
        let project_id = project_id.to_string();
        Box::pin(async move {
            let chats = self.host_db.chats_list(&project_id);
            Ok(chats.iter().map(to_summary).collect())
        })
    }

    fn get_chat_by_id(
        &self,
        chat_id: &str,
    ) -> BoxFuture<'_, Result<Option<ChatSummary>, PluginError>> {
        let chat_id = chat_id.to_string();
        Box::pin(async move { Ok(self.host_db.chats_get(&chat_id).as_ref().map(to_summary)) })
    }

    fn can_create_chat(&self) -> bool {
        self.can_create
    }

    fn create_chat(
        &self,
        args: CreateChatArgs,
    ) -> BoxFuture<'_, Result<CreateChatResult, PluginError>> {
        Box::pin(async move {
            let effective_adapter = args.adapter_id.unwrap_or_else(|| "claude".to_string());
            let mut effective_model = args.model;
            let mut effective_mode = args.permission_mode;

            if effective_model.is_none() || effective_mode.is_none() {
                let default_model = self
                    .host_db
                    .settings_get("provider", &format!("{effective_adapter}.defaultModel"));
                let default_mode = self
                    .host_db
                    .settings_get("provider", &format!("{effective_adapter}.defaultMode"));
                if effective_model.is_none()
                    && let Some(m) = default_model
                {
                    effective_model = Some(m);
                }
                if effective_mode.is_none()
                    && let Some(m) = default_mode
                {
                    effective_mode = Some(m);
                }
            }

            let chat = self.host_db.chats_create(
                &args.project_id,
                &effective_adapter,
                effective_model.as_deref(),
                effective_mode.as_deref(),
            );
            let chat_id = chat.id.clone();
            (self.emit)(DaemonEvent::ChatCreated { chat, source: None });
            Ok(CreateChatResult { chat_id })
        })
    }
}

// PORT STATUS: src/plugins/services/chat-service.ts
// confidence: high
// todos: 0
// notes: listChats/getChatById map Chat→ChatSummary (title stays string|null).
// getMessages (chat:read:content) returns [] in the TS — no builtin uses it, so
// it is not part of this trait (a WASM loader would add it with the capability).
// createChat gates on chat:create (can_create_chat), reads
// `<adapter>.defaultModel`/`.defaultMode` when model/mode are unset, and emits
// `chat.created` with `source: None` (the TS event carries only `{ type, chat }`).
