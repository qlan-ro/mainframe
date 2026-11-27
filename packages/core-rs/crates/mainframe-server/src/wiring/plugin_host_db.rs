//! The daemon-side `PluginHostDb`: chat creation through the `Db` actor and
//! settings through `Db`'s `SettingsKv`.

use crate::db::Db;
use mainframe_plugins::{BoxFuture, PluginError, PluginHostDb};
use mainframe_types::chat::{Chat, NewChat};
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
    fn create_chat(&self, new_chat: NewChat) -> BoxFuture<'_, Result<Chat, PluginError>> {
        Box::pin(async move {
            self.db
                .call(move |db| db.chats.create(&new_chat))
                .await
                .map_err(Into::into)
        })
    }

    fn settings(&self) -> &dyn SettingsKv {
        &self.db
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_chat_that_cannot_be_stored_is_reported() {
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
        let new_chat = NewChat {
            project_id: "p".into(),
            adapter_id: "claude".into(),
            ..Default::default()
        };
        assert!(host.create_chat(new_chat).await.is_err());
    }
}
