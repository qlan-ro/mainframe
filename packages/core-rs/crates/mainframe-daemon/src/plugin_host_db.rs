//! The daemon-side `PluginHostDb` — the `DatabaseManager` slice the plugin
//! contexts read, bridged onto the async `Db` actor via `call_blocking` (the same
//! SYNC-DB BRIDGE the `ChatManagerDeps` accessors use).

use mainframe_plugins::PluginHostDb;
use mainframe_server::db::Db;
use mainframe_types::chat::Chat;

pub struct DaemonPluginHostDb {
    db: Db,
}

impl DaemonPluginHostDb {
    pub fn new(db: Db) -> Self {
        Self { db }
    }
}

impl PluginHostDb for DaemonPluginHostDb {
    fn chats_list(&self, project_id: &str) -> Vec<Chat> {
        let pid = project_id.to_string();
        self.db
            .call_blocking(move |d| d.chats.list(&pid))
            .unwrap_or_default()
    }

    fn chats_get(&self, id: &str) -> Option<Chat> {
        let id = id.to_string();
        self.db
            .call_blocking(move |d| d.chats.get(&id))
            .ok()
            .flatten()
    }

    fn chats_create(
        &self,
        project_id: &str,
        adapter_id: &str,
        model: Option<&str>,
        permission_mode: Option<&str>,
    ) -> Chat {
        let new_chat = mainframe_types::chat::NewChat {
            project_id: project_id.to_string(),
            adapter_id: adapter_id.to_string(),
            model: model.map(str::to_string),
            permission_mode: permission_mode.map(str::to_string),
            ..Default::default()
        };
        let input = new_chat.clone();
        match self.db.call_blocking(move |d| d.chats.create(&input)) {
            Ok(chat) => chat,
            Err(err) => {
                // The trait is infallible; a DB failure has no error channel, so log + return an
                // unpersisted stub rather than crash the plugin request.
                tracing::error!(%err, project_id, adapter_id, "plugin chats.create failed");
                Chat::unpersisted(&new_chat)
            }
        }
    }

    fn settings_get(&self, category: &str, key: &str) -> Option<String> {
        let (cat, key) = (category.to_string(), key.to_string());
        self.db
            .call_blocking(move |d| Ok(d.settings.get(&cat, &key).ok().flatten()))
            .ok()
            .flatten()
    }
}
