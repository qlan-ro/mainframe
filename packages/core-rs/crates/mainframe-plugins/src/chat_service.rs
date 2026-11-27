//! Chat creation for plugins that declare `chat:create`: fills the model and
//! permission mode from the adapter's provider defaults, writes the chat row
//! and emits `chat.created`.

use std::sync::Arc;

use mainframe_services::settings::read_setting;
use mainframe_types::chat::NewChat;
use mainframe_types::events::DaemonEvent;

use crate::PluginError;
use crate::context::{EmitSink, PluginHostDb};

/// The adapter a plugin chat runs on when the caller names none.
const DEFAULT_ADAPTER: &str = "claude";

/// What a plugin asks for when it creates a chat; unset fields fall back to
/// the provider defaults.
#[derive(Debug, Clone, Default)]
pub struct CreateChatArgs {
    pub project_id: String,
    pub adapter_id: Option<String>,
    pub model: Option<String>,
    pub permission_mode: Option<String>,
}

pub struct ChatService {
    can_create: bool,
    host_db: Arc<dyn PluginHostDb>,
    emit: EmitSink,
}

impl ChatService {
    pub(crate) fn new(can_create: bool, host_db: Arc<dyn PluginHostDb>, emit: EmitSink) -> Self {
        Self {
            can_create,
            host_db,
            emit,
        }
    }

    /// Whether the manifest declares `chat:create`.
    pub fn can_create_chat(&self) -> bool {
        self.can_create
    }

    /// Creates the chat and returns its id. Callers check
    /// [`ChatService::can_create_chat`] first.
    pub async fn create_chat(&self, args: CreateChatArgs) -> Result<String, PluginError> {
        if !self.can_create {
            return Err(PluginError::CapabilityRequired("chat:create".to_string()));
        }
        let adapter_id = args
            .adapter_id
            .unwrap_or_else(|| DEFAULT_ADAPTER.to_string());
        let model = match args.model {
            Some(model) => Some(model),
            None => self.provider_default(&adapter_id, "defaultModel").await,
        };
        let permission_mode = match args.permission_mode {
            Some(mode) => Some(mode),
            None => self.provider_default(&adapter_id, "defaultMode").await,
        };
        let chat = self
            .host_db
            .create_chat(NewChat {
                project_id: args.project_id,
                adapter_id,
                model,
                permission_mode,
                ..Default::default()
            })
            .await?;
        let chat_id = chat.id.clone();
        (self.emit)(DaemonEvent::ChatCreated { chat, source: None });
        Ok(chat_id)
    }

    async fn provider_default(&self, adapter_id: &str, key: &str) -> Option<String> {
        read_setting(
            self.host_db.settings(),
            "provider",
            &format!("{adapter_id}.{key}"),
        )
        .await
    }
}
