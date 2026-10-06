//! Agent provenance on chats (migration 32). Kept out of `chats.rs` and its
//! `CHAT_SELECT_FIELDS`: only the orchestration server reads it, through
//! these narrow queries.

use std::collections::HashMap;

use crate::DbError;
use crate::chats::ChatsRepository;

impl ChatsRepository {
    /// Records which chat's agent created `chat_id` (and, for a delegated
    /// child, the parent it nests under).
    pub fn set_agent_lineage(
        &self,
        chat_id: &str,
        created_by_chat_id: &str,
        parent_chat_id: Option<&str>,
    ) -> Result<(), DbError> {
        self.db.execute(
            "UPDATE chats SET created_by_chat_id = ?, \
             parent_chat_id = COALESCE(?, parent_chat_id) WHERE id = ?",
            rusqlite::params![created_by_chat_id, parent_chat_id, chat_id],
        )?;
        Ok(())
    }

    pub fn created_by(&self, chat_id: &str) -> Result<Option<String>, DbError> {
        let mut stmt = self
            .db
            .prepare("SELECT created_by_chat_id FROM chats WHERE id = ?")?;
        let mut rows = stmt.query([chat_id])?;
        match rows.next()? {
            Some(row) => Ok(row.get(0)?),
            None => Ok(None),
        }
    }

    /// `chat id → creator` for every agent-created chat in a project.
    pub fn created_by_in_project(
        &self,
        project_id: &str,
    ) -> Result<HashMap<String, String>, DbError> {
        let mut stmt = self.db.prepare(
            "SELECT id, created_by_chat_id FROM chats \
             WHERE project_id = ? AND created_by_chat_id IS NOT NULL",
        )?;
        let rows = stmt.query_map([project_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut map = HashMap::new();
        for row in rows {
            let (id, creator) = row?;
            map.insert(id, creator);
        }
        Ok(map)
    }
}
