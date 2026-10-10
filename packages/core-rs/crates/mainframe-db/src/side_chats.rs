//! Side chats (todo #344): a parent chat has at most one side chat at a time.
//! Kept in its own file so `chats.rs` (996 lines) grows only by the
//! `CHAT_SELECT_FIELDS` subquery, the row mapping, and the `list_filtered`
//! exclusion clause.

use mainframe_runtime::time::now_iso8601;
use mainframe_types::chat::Chat;

use crate::chats::{CHAT_SELECT_FIELDS, ChatsRepository};
use crate::{DbError, enum_to_db_string};

impl ChatsRepository {
    /// Returns the parent's existing side chat (`created = false`), or inserts
    /// a new one seeded from the parent's resolved config (`created = true`).
    /// The select-then-insert here, combined with the partial unique index
    /// (migration 30) and the DB worker running one closure at a time, makes
    /// two concurrent opens on the same parent converge on a single row (see
    /// the plan's `## Established facts`).
    pub fn find_or_create_side_chat(&self, parent: &Chat) -> Result<(Chat, bool), DbError> {
        if let Some(existing) = self.find_side_chat(&parent.id)? {
            return Ok((existing, false));
        }

        let id = nanoid::nanoid!();
        let now = now_iso8601();
        let permission_bind = parent
            .permission_mode
            .as_ref()
            .map(enum_to_db_string)
            .transpose()?;

        self.db.execute(
            "INSERT INTO chats (
                id, adapter_id, project_id, model, permission_mode, plan_mode,
                worktree_path, branch_name, scratch_path,
                parent_chat_id, temporary,
                status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?)",
            rusqlite::params![
                id,
                parent.adapter_id,
                parent.project_id,
                parent.model,
                permission_bind,
                i64::from(parent.plan_mode.unwrap_or(false)),
                parent.worktree_path,
                parent.branch_name,
                parent.scratch_path,
                parent.id,
                now,
                now,
            ],
        )?;
        crate::chat_segments::ensure_seeded(&self.db, &id)?;

        Ok((self.get_inserted(&id)?, true))
    }

    fn find_side_chat(&self, parent_id: &str) -> Result<Option<Chat>, DbError> {
        let sql = format!(
            "SELECT {CHAT_SELECT_FIELDS} FROM chats WHERE parent_chat_id = ? AND temporary = 1"
        );
        Ok(self.query_chats(&sql, rusqlite::params![parent_id])?.pop())
    }
}
