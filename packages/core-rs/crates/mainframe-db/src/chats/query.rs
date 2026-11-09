//! Reads that return `Chat` rows: listings, single lookups, and the shared
//! `CHAT_SELECT_FIELDS` projection with its derived columns.

use mainframe_types::chat::Chat;
use rusqlite::types::Value as SqlValue;

use super::ChatsRepository;
use super::row::ChatRow;
use crate::DbError;
use crate::delegated_tasks::open_task_statuses;
use crate::sql_types::FromRow;

const CHAT_SELECT_FIELDS: &str = concat!(
    "id, adapter_id, project_id, \
  title, claude_session_id, model, \
  permission_mode, status, \
  created_at, updated_at, \
  total_cost, total_tokens_input, \
  total_tokens_output, last_context_tokens_input, \
  last_context_total_tokens, last_context_max_tokens, \
  mentions, modified_files, \
  worktree_path, branch_name, \
  process_state, todos, pinned, effort, \
  plan_mode, detected_prs, \
  session_file_path, \
  transcript_missing, \
  fast, ultracode, adaptive_thinking, \
  automation_run_id, \
  temporary, vendor_session_ephemeral, \
  context_lost_at, scratch_path, \
  parent_chat_id, \
  (SELECT s.id FROM chats s WHERE s.parent_chat_id = chats.id AND s.temporary = 1) AS sideChatId, \
  created_by_chat_id as createdByChatId, \
  (SELECT t.id || ' ' || t.role || ' ' || t.status FROM delegated_tasks t \
     WHERE t.child_chat_id = chats.id) AS delegation, \
  (WITH RECURSIVE open_tasks(child) AS ( \
       SELECT t.child_chat_id FROM delegated_tasks t \
         WHERE t.parent_chat_id = chats.id AND t.status IN ",
    open_task_statuses!(),
    " UNION SELECT t.child_chat_id FROM delegated_tasks t JOIN open_tasks o \
         ON t.parent_chat_id = o.child WHERE t.status IN ",
    open_task_statuses!(),
    ") SELECT group_concat(child, ' ') FROM open_tasks) AS activeDelegatedChildIds, \
     EXISTS(SELECT 1 FROM delegated_tasks t WHERE t.parent_chat_id = chats.id \
       AND t.status = 'running') AS hasRunningDelegatedTask"
);

#[derive(Debug, Clone, Default)]
pub struct ChatListFilters {
    pub project_id: Option<String>,
    pub tags_all: Option<Vec<String>>,
    pub has_worktree: bool,
    pub include_archived: bool,
    /// Temporary chats are excluded from default listings (like the automation
    /// filter, always-applied); this opts a caller back in.
    pub include_temporary: bool,
}

impl ChatsRepository {
    pub fn list(&self, project_id: &str) -> Result<Vec<Chat>, DbError> {
        let sql = format!(
            "SELECT {CHAT_SELECT_FIELDS} FROM chats WHERE project_id = ? ORDER BY pinned DESC, updated_at DESC"
        );
        let mut chats = self.query_chats(&sql, rusqlite::params![project_id])?;
        self.populate_bulk_tags(&mut chats)?;
        Ok(chats)
    }

    pub fn list_all(&self) -> Result<Vec<Chat>, DbError> {
        let sql = format!(
            "SELECT {CHAT_SELECT_FIELDS} FROM chats ORDER BY pinned DESC, updated_at DESC, rowid DESC"
        );
        let mut chats = self.query_chats(&sql, [])?;
        self.populate_bulk_tags(&mut chats)?;
        Ok(chats)
    }

    pub fn list_filtered(&self, filters: &ChatListFilters) -> Result<Vec<Chat>, DbError> {
        let mut where_clauses: Vec<String> = Vec::new();
        let mut params: Vec<SqlValue> = Vec::new();

        if !filters.include_archived {
            where_clauses.push("status != 'archived'".to_string());
        }
        // Automation-created chats (ask_agent steps) are hidden from the default sidebar list.
        where_clauses.push("automation_run_id IS NULL".to_string());
        if !filters.include_temporary {
            where_clauses.push("temporary = 0".to_string());
        }
        // Side chats are never a listing result, even when the caller opted back
        // into temporary chats — they are reachable only through their parent.
        where_clauses.push("NOT (temporary = 1 AND parent_chat_id IS NOT NULL)".to_string());
        if let Some(project_id) = &filters.project_id {
            where_clauses.push("project_id = ?".to_string());
            params.push(SqlValue::Text(project_id.clone()));
        }
        if filters.has_worktree {
            where_clauses.push("worktree_path IS NOT NULL".to_string());
        }
        if let Some(tags_all) = &filters.tags_all
            && !tags_all.is_empty()
        {
            let ids = match self.chat_tags.filter_chat_ids(tags_all)? {
                Some(ids) if !ids.is_empty() => ids,
                _ => return Ok(Vec::new()),
            };
            let placeholders = vec!["?"; ids.len()].join(",");
            where_clauses.push(format!("id IN ({placeholders})"));
            for id in ids {
                params.push(SqlValue::Text(id));
            }
        }

        let where_sql = if where_clauses.is_empty() {
            String::new()
        } else {
            format!(" WHERE {}", where_clauses.join(" AND "))
        };
        let sql = format!(
            "SELECT {CHAT_SELECT_FIELDS} FROM chats{where_sql} ORDER BY pinned DESC, updated_at DESC"
        );
        let mut chats = self.query_chats(&sql, rusqlite::params_from_iter(params))?;
        self.populate_bulk_tags(&mut chats)?;
        Ok(chats)
    }

    pub fn get(&self, id: &str) -> Result<Option<Chat>, DbError> {
        self.query_chat("id = ?", rusqlite::params![id])
    }

    pub fn get_imported_session_ids(&self, project_id: &str) -> Result<Vec<String>, DbError> {
        let mut stmt = self
            .db
            .prepare("SELECT n.native_session_id FROM chat_native_sessions n JOIN chats c ON c.id = n.chat_id \
                      WHERE c.project_id = ? AND n.native_session_id IS NOT NULL \
                      AND n.borrowed_from_chat_id IS NULL")?;
        let rows = stmt.query_map([project_id], |row| row.get::<_, String>(0))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn find_by_external_session_id(
        &self,
        session_id: &str,
        project_id: &str,
    ) -> Result<Option<Chat>, DbError> {
        self.query_chat(
            "id IN (SELECT chat_id FROM chat_native_sessions WHERE native_session_id = ? \
             AND borrowed_from_chat_id IS NULL) AND project_id = ?",
            rusqlite::params![session_id, project_id],
        )
    }

    /// The one chat matching `condition`, tags included.
    // pub(crate): reused by `side_chats.rs`'s lookup.
    pub(crate) fn query_chat<P: rusqlite::Params>(
        &self,
        condition: &str,
        params: P,
    ) -> Result<Option<Chat>, DbError> {
        let sql = format!("SELECT {CHAT_SELECT_FIELDS} FROM chats WHERE {condition}");
        let Some(mut chat) = self.query_chats(&sql, params)?.pop() else {
            return Ok(None);
        };
        chat.tags = Some(self.chat_tags.list_for_chat(&chat.id)?);
        Ok(Some(chat))
    }

    fn query_chats<P: rusqlite::Params>(&self, sql: &str, params: P) -> Result<Vec<Chat>, DbError> {
        let mut stmt = self.db.prepare(sql)?;
        let mut rows = stmt.query(params)?;
        let mut chats = Vec::new();
        while let Some(row) = rows.next()? {
            chats.push(map_row(row)?);
        }
        Ok(chats)
    }

    fn populate_bulk_tags(&self, chats: &mut [Chat]) -> Result<(), DbError> {
        if chats.is_empty() {
            return Ok(());
        }
        let ids: Vec<String> = chats.iter().map(|c| c.id.clone()).collect();
        let mut tags_by_chat = self.chat_tags.bulk_for_chats(&ids)?;
        for chat in chats {
            chat.tags = Some(tags_by_chat.remove(&chat.id).unwrap_or_default());
        }
        Ok(())
    }
}

fn map_row(row: &rusqlite::Row<'_>) -> Result<Chat, DbError> {
    let mut chat = ChatRow::from_row(row)?.into_chat();
    chat.side_chat_id = row.get("sideChatId")?;
    chat.orchestration = crate::orchestration::map_orchestration(row)?;
    Ok(chat)
}
