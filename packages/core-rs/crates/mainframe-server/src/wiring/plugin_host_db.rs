//! The daemon-side `PluginHostDb` — the `DatabaseManager` slice the plugin
//! contexts read. Chat accessors are bridged onto the async `Db` actor via
//! `call_blocking` (the same SYNC-DB BRIDGE the `ChatManagerDeps` accessors
//! use); settings go through `Db`'s `SettingsKv`.

use crate::db::Db;
use mainframe_plugins::PluginHostDb;
use mainframe_types::chat::Chat;
use mainframe_types::settings_kv::SettingsKv;

pub struct DaemonPluginHostDb {
    db: Db,
}

impl DaemonPluginHostDb {
    pub fn new(db: Db) -> Self {
        Self { db }
    }
}

impl PluginHostDb for DaemonPluginHostDb {
    fn chats_list(&self, project_id: &str) -> Result<Vec<Chat>, mainframe_plugins::PluginError> {
        let pid = project_id.to_owned();
        self.db
            .call_blocking(move |db| db.chats.list(&pid))
            .map_err(Into::into)
    }

    fn chats_get(&self, id: &str) -> Result<Option<Chat>, mainframe_plugins::PluginError> {
        let id = id.to_owned();
        self.db
            .call_blocking(move |db| db.chats.get(&id))
            .map_err(Into::into)
    }

    fn chats_create(
        &self,
        project_id: &str,
        adapter_id: &str,
        model: Option<&str>,
        permission_mode: Option<&str>,
    ) -> Result<Chat, mainframe_plugins::PluginError> {
        let new_chat = mainframe_types::chat::NewChat {
            project_id: project_id.into(),
            adapter_id: adapter_id.into(),
            model: model.map(str::to_owned),
            permission_mode: permission_mode.map(str::to_owned),
            ..Default::default()
        };
        self.db
            .call_blocking(move |db| db.chats.create(&new_chat))
            .map_err(Into::into)
    }

    fn settings(&self) -> &dyn SettingsKv {
        &self.db
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn failed_chat_storage_is_reported_instead_of_empty_or_unpersisted_rows() {
        let db =
            Db::spawn(|| mainframe_db::DatabaseManager::open(std::path::Path::new(":memory:")))
                .unwrap();
        db.call(|db| {
            db.connection().execute_batch("DROP TABLE chats")?;
            Ok(())
        })
        .await
        .unwrap();
        let host = DaemonPluginHostDb::new(db);
        assert!(host.chats_list("p").is_err());
        assert!(host.chats_get("c").is_err());
        assert!(host.chats_create("p", "claude", None, None).is_err());
    }
}
