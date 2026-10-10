mod row;
use crate::chat_assignments::ChatAssignments;
use crate::sql_types::FromRow;
use mainframe_types::chat_patch::ChatPatch;
use row::ChatRow;
use std::rc::Rc;

use mainframe_types::adapter::{DetectedPr, DetectedPrSource, EffortLevel, ForkSource};
use mainframe_types::chat::{Chat, ChatStatus, NO_PROJECT_ID, NewChat, ProcessState, TodoItem};
use mainframe_types::context::{SessionMention, SkillFileEntry};
use mainframe_types::segment::ForkPlan;
use mainframe_types::settings::ExecutionMode;
use mainframe_types::time::now_iso8601;
use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::chat_native_sessions::NativePatch;
use crate::chat_segments;
use crate::chat_tags::ChatTagsRepository;
use crate::{DbError, enum_to_db_string};

// pub(crate): reused by `side_chats.rs` for the side chat's own SELECT.
pub(crate) const CHAT_SELECT_FIELDS: &str = "id, adapter_id, project_id, \
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
         WHERE t.parent_chat_id = chats.id AND t.status IN ('queued', 'running', 'waiting') \
       UNION SELECT t.child_chat_id FROM delegated_tasks t JOIN open_tasks o \
         ON t.parent_chat_id = o.child WHERE t.status IN ('queued', 'running', 'waiting')) \
     SELECT group_concat(child, ' ') FROM open_tasks) \
     AS activeDelegatedChildIds";

/// The still-pending fork state stored in `chats.pending_fork` (JSON), read and
/// written only through `get_pending_fork` / `clear_pending_fork` —
/// deliberately absent from the `Chat` wire type, like `dismissed_worktrees`.
/// Retired once the fork's first turn produces a result (`on_result`), which
/// also removes `snapshot_dir` from disk.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingFork {
    pub fork_source: ForkSource,
    pub snapshot_dir: String,
    pub provisional_title: String,
}

/// Inputs to `ChatsRepository::create_fork`, gathered from the enriched parent
/// chat by `ChatManager::fork_chat` (mainframe-chat, Group 3). Tags and pin
/// state are deliberately absent — the fork inherits neither.
#[derive(Debug, Clone)]
pub struct ForkInsert<'a> {
    pub parent_chat_id: &'a str,
    pub project_id: &'a str,
    pub adapter_id: &'a str,
    pub model: Option<&'a str>,
    pub permission_mode: Option<ExecutionMode>,
    pub plan_mode: bool,
    pub effort: Option<EffortLevel>,
    pub fast: Option<bool>,
    pub ultracode: Option<bool>,
    pub adaptive_thinking: Option<bool>,
    pub worktree_path: Option<&'a str>,
    pub branch_name: Option<&'a str>,
    pub title: Option<&'a str>,
    pub pending_fork: &'a PendingFork,
    /// A multi-segment parent's segments, copied as planned. `None` seeds the
    /// usual single initial segment.
    pub segments: Option<&'a ForkPlan>,
}

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

/// The part of a `chats` patch that belongs to the active native session.
fn native_patch(updates: &ChatPatch) -> NativePatch {
    NativePatch {
        adapter_id: updates.adapter_id.clone(),
        model: updates.model.clone(),
        session_file_path: updates.session_file_path.clone(),
        last_context_tokens_input: updates.last_context_tokens_input,
        last_context_total_tokens: updates.last_context_total_tokens,
        last_context_max_tokens: updates.last_context_max_tokens,
        transcript_missing: updates.transcript_missing,
    }
}

fn parse_effort(value: Option<String>) -> Option<EffortLevel> {
    crate::sql_types::SqlEnum::or_default(value, None)
}

fn parse_nullable_bool(value: Option<i64>) -> Option<Option<bool>> {
    Some(value.map(|value| value != 0))
}

fn parse_execution_mode(value: Option<String>) -> Option<ExecutionMode> {
    crate::sql_types::SqlEnum::or_default(value, None)
}

fn parse_process_state(value: Option<String>) -> Option<ProcessState> {
    crate::sql_types::SqlEnum::or_default(value, None)
}

fn parse_chat_status(value: String) -> ChatStatus {
    crate::sql_types::SqlEnum::or_default(Some(value), ChatStatus::Active)
}

fn parse_json_column<T: serde::de::DeserializeOwned>(value: Option<String>, fallback: T) -> T {
    crate::sql_types::JsonCol::or_default(value, fallback)
}

fn parse_json_array<T: serde::de::DeserializeOwned>(value: Option<String>) -> Vec<T> {
    parse_json_column(value, Vec::new())
}

pub struct ChatsRepository {
    // pub(crate): reused by `side_chats.rs`'s find-then-insert.
    pub(crate) db: Rc<Connection>,
    chat_tags: Option<ChatTagsRepository>,
}

impl ChatsRepository {
    pub fn new(db: Rc<Connection>, chat_tags: Option<ChatTagsRepository>) -> Self {
        Self { db, chat_tags }
    }

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
            let Some(chat_tags) = &self.chat_tags else {
                return Err(DbError::Message(
                    "listFiltered with tagsAll requires ChatTagsRepository".to_string(),
                ));
            };
            let ids = match chat_tags.filter_chat_ids(tags_all)? {
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
        let sql = format!("SELECT {CHAT_SELECT_FIELDS} FROM chats WHERE id = ?");
        let mut chats = self.query_chats(&sql, rusqlite::params![id])?;
        match chats.pop() {
            Some(mut chat) => {
                self.populate_tags(&mut chat)?;
                Ok(Some(chat))
            }
            None => Ok(None),
        }
    }

    /// Reads back a row this repository just inserted. Every insert path
    /// returns its `Chat` through here, so the value a caller emits as
    /// `chat.created` comes from the same `map_row` mapping as every later
    /// read and carries the same keys.
    pub(crate) fn get_inserted(&self, id: &str) -> Result<Chat, DbError> {
        self.get(id)?
            .ok_or_else(|| DbError::Message(format!("chat {id} insert did not round-trip")))
    }

    /// `new_chat.scratch_root` is required and used only when `project_id ==
    /// NO_PROJECT_ID`: the row's `scratch_path` becomes `<scratch_root>/<id>`.
    /// Nothing is created on disk here — the directory is created lazily on
    /// first spawn (rule 6).
    pub fn create(&self, new_chat: &NewChat) -> Result<Chat, DbError> {
        let id = nanoid::nanoid!();
        let now = now_iso8601();
        // `model || null` / `permissionMode || null` — empty string binds NULL.
        let model_bind = new_chat.model.as_deref().filter(|s| !s.is_empty());
        let permission_bind = new_chat
            .permission_mode
            .as_deref()
            .filter(|s| !s.is_empty());
        let automation_run_id_bind = new_chat
            .automation_run_id
            .as_deref()
            .filter(|s| !s.is_empty());
        let scratch_path = if new_chat.project_id == NO_PROJECT_ID {
            new_chat
                .scratch_root
                .as_deref()
                .map(|root| format!("{root}/{id}"))
        } else {
            None
        };

        let tx = self.db.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO chats (id, adapter_id, project_id, model, permission_mode, status, created_at, updated_at, automation_run_id, temporary, scratch_path) \
             VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)",
            rusqlite::params![
                id,
                new_chat.adapter_id,
                new_chat.project_id,
                model_bind,
                permission_bind,
                now,
                now,
                automation_run_id_bind,
                i64::from(new_chat.temporary),
                scratch_path,
            ],
        )?;
        chat_segments::ensure_seeded(&self.db, &id)?;

        let chat = self.get_inserted(&id)?;
        tx.commit()?;
        Ok(chat)
    }

    /// A single INSERT that seeds a new chat from its parent's resolved config:
    /// project, adapter, model, permission mode, plan mode, tuning,
    /// worktree, and a provisional title, plus the `parent_chat_id` lineage and
    /// the `pending_fork` payload the daemon resolves the first spawn from.
    /// Counters start at zero; the fork is unpinned, untagged, and carries no
    /// automation run.
    pub fn create_fork(&self, insert: &ForkInsert<'_>) -> Result<Chat, DbError> {
        let id = nanoid::nanoid!();
        let now = now_iso8601();
        let permission_bind = insert
            .permission_mode
            .as_ref()
            .map(enum_to_db_string)
            .transpose()?;
        let effort_bind = insert.effort.as_ref().map(enum_to_db_string).transpose()?;
        let pending_fork_json = serde_json::to_string(insert.pending_fork)?;

        let tx = self.db.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO chats (
                id, adapter_id, project_id, model, permission_mode, plan_mode,
                effort, fast, ultracode, adaptive_thinking,
                worktree_path, branch_name, title,
                parent_chat_id, pending_fork,
                status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)",
            rusqlite::params![
                id,
                insert.adapter_id,
                insert.project_id,
                insert.model,
                permission_bind,
                i64::from(insert.plan_mode),
                effort_bind,
                insert.fast.map(i64::from),
                insert.ultracode.map(i64::from),
                insert.adaptive_thinking.map(i64::from),
                insert.worktree_path,
                insert.branch_name,
                insert.title,
                insert.parent_chat_id,
                pending_fork_json,
                now,
                now,
            ],
        )?;
        match insert.segments {
            Some(plan) => crate::chat_segments_fork::copy_from_parent(
                &tx,
                &id,
                insert.parent_chat_id,
                insert.model,
                plan,
            )?,
            None => chat_segments::ensure_seeded(&tx, &id)?,
        }
        let chat = self.get_inserted(&id)?;
        tx.commit()?;
        Ok(chat)
    }

    /// Hard-delete a chat row (rule 5, discard step 4). `chat_tags` cascade via
    /// `ON DELETE CASCADE` (`PRAGMA foreign_keys = ON`).
    pub fn delete(&self, id: &str) -> Result<(), DbError> {
        self.db
            .execute("DELETE FROM chats WHERE id = ?", rusqlite::params![id])?;
        Ok(())
    }

    /// Rule 7's context-loss write: the stored provider session can no longer be
    /// resumed, so the resume target and the ephemeral flag are cleared together
    /// with stamping the loss time.
    pub fn mark_context_lost(&self, id: &str, context_lost_at: &str) -> Result<(), DbError> {
        let tx = self.db.unchecked_transaction()?;
        chat_segments::clear_active_native_id(&tx, id)?;
        tx.execute(
            "UPDATE chats SET context_lost_at = ?, vendor_session_ephemeral = 0 WHERE id = ?",
            rusqlite::params![context_lost_at, id],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Session columns (`claude_session_id`, `session_file_path`, context
    /// usage, `transcript_missing`, adapter and model) are routed through the
    /// segment repository first, in the same transaction, so the `chats`
    /// mirror and the active native-session row never disagree.
    pub fn update(&self, id: &str, updates: &ChatPatch) -> Result<(), DbError> {
        let tx = self.db.unchecked_transaction()?;
        if let Some(native_id) = &updates.claude_session_id {
            chat_segments::record_native_id(
                &tx,
                id,
                native_id,
                updates.session_file_path.as_deref(),
            )?;
        }
        chat_segments::absorb_chat_patch(&tx, id, &native_patch(updates))?;
        self.update_columns(id, updates)?;
        tx.commit()?;
        Ok(())
    }

    fn update_columns(&self, id: &str, updates: &ChatPatch) -> Result<(), DbError> {
        let (sets, mut values) = updates.into_assignments()?;

        if sets.is_empty() {
            return Ok(());
        }
        values.push(SqlValue::Text(id.to_string()));
        let sql = format!("UPDATE chats SET {} WHERE id = ?", sets.join(", "));
        self.db.execute(&sql, rusqlite::params_from_iter(values))?;
        Ok(())
    }

    pub fn get_mentions(&self, chat_id: &str) -> Result<Vec<SessionMention>, DbError> {
        let raw = self.read_text_column("mentions", chat_id)?;
        Ok(parse_json_array(raw))
    }

    pub fn add_mention(&self, chat_id: &str, mention: &SessionMention) -> Result<bool, DbError> {
        let mut existing = self.get_mentions(chat_id)?;
        let is_duplicate = existing
            .iter()
            .any(|m| m.kind == mention.kind && m.name == mention.name && m.path == mention.path);
        if is_duplicate {
            return Ok(false);
        }
        existing.push(mention.clone());
        self.db.execute(
            "UPDATE chats SET mentions = ? WHERE id = ?",
            rusqlite::params![serde_json::to_string(&existing)?, chat_id],
        )?;
        Ok(true)
    }

    pub fn get_plan_files(&self, chat_id: &str) -> Result<Vec<String>, DbError> {
        let raw = self.read_text_column("plan_files", chat_id)?;
        Ok(parse_json_array(raw))
    }

    pub fn add_plan_file(&self, chat_id: &str, file_path: &str) -> Result<bool, DbError> {
        let mut existing = self.get_plan_files(chat_id)?;
        if existing.iter().any(|p| p == file_path) {
            return Ok(false);
        }
        existing.push(file_path.to_string());
        self.db.execute(
            "UPDATE chats SET plan_files = ? WHERE id = ?",
            rusqlite::params![serde_json::to_string(&existing)?, chat_id],
        )?;
        Ok(true)
    }

    /// Worktree paths this chat has permanently turned down. Daemon-internal —
    /// deliberately absent from the `Chat` API payload.
    pub fn get_dismissed_worktrees(&self, chat_id: &str) -> Result<Vec<String>, DbError> {
        let raw = self.read_text_column("dismissed_worktrees", chat_id)?;
        Ok(parse_json_array(raw))
    }

    /// Returns `false` when the path was already dismissed, without writing.
    pub fn add_dismissed_worktree(
        &self,
        chat_id: &str,
        worktree_path: &str,
    ) -> Result<bool, DbError> {
        let mut existing = self.get_dismissed_worktrees(chat_id)?;
        if existing.iter().any(|p| p == worktree_path) {
            return Ok(false);
        }
        existing.push(worktree_path.to_string());
        self.db.execute(
            "UPDATE chats SET dismissed_worktrees = ? WHERE id = ?",
            rusqlite::params![serde_json::to_string(&existing)?, chat_id],
        )?;
        Ok(true)
    }

    /// The still-pending fork state for a chat whose first turn hasn't produced
    /// a result yet. Daemon-internal, like `dismissed_worktrees`.
    pub fn get_pending_fork(&self, chat_id: &str) -> Result<Option<PendingFork>, DbError> {
        let raw = self.read_text_column("pending_fork", chat_id)?;
        match raw.filter(|s| !s.is_empty()) {
            Some(s) => Ok(Some(serde_json::from_str(&s)?)),
            None => Ok(None),
        }
    }

    /// Retire a fork's pending state once its first turn produces a result.
    /// Callers are responsible for removing `PendingFork.snapshot_dir` from disk.
    pub fn clear_pending_fork(&self, chat_id: &str) -> Result<(), DbError> {
        self.db.execute(
            "UPDATE chats SET pending_fork = NULL WHERE id = ?",
            rusqlite::params![chat_id],
        )?;
        Ok(())
    }

    pub fn get_skill_files(&self, chat_id: &str) -> Result<Vec<SkillFileEntry>, DbError> {
        let raw = self.read_text_column("skill_files", chat_id)?;
        let entries: Vec<Value> = parse_json_array(raw);
        Ok(entries
            .into_iter()
            .map(|entry| {
                let skill_path = match entry {
                    Value::String(s) => s,
                    other => other
                        .get("path")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                };
                let mut segments: Vec<&str> = skill_path.split('/').collect();
                let file = segments.pop().unwrap_or(skill_path.as_str()).to_string();
                let name = if file == "SKILL.md" {
                    match segments.pop() {
                        Some(seg) => seg.to_string(),
                        None => file.clone(),
                    }
                } else {
                    file.clone()
                };
                SkillFileEntry {
                    path: skill_path.clone(),
                    display_name: name,
                }
            })
            .collect())
    }

    pub fn add_skill_file(&self, chat_id: &str, entry: &SkillFileEntry) -> Result<bool, DbError> {
        let mut existing = self.get_skill_files(chat_id)?;
        if existing.iter().any(|e| e.path == entry.path) {
            return Ok(false);
        }
        existing.push(entry.clone());
        self.db.execute(
            "UPDATE chats SET skill_files = ? WHERE id = ?",
            rusqlite::params![serde_json::to_string(&existing)?, chat_id],
        )?;
        Ok(true)
    }

    pub fn get_detected_prs(&self, chat_id: &str) -> Result<Vec<DetectedPr>, DbError> {
        let raw = self.read_text_column("detected_prs", chat_id)?;
        Ok(parse_json_array(raw))
    }

    /// Persist newly-detected PRs, deduplicating by URL. Returns the rows that
    /// were actually written (i.e. either new, or had their `source` upgraded
    /// from `mentioned` → `created`). Existing 'created' entries are never
    /// downgraded to 'mentioned'.
    pub fn add_detected_prs(
        &self,
        chat_id: &str,
        prs: &[DetectedPr],
    ) -> Result<Vec<DetectedPr>, DbError> {
        let mut by_url = self.get_detected_prs(chat_id)?;
        let mut written: Vec<DetectedPr> = Vec::new();
        let mut mutated = false;

        for pr in prs {
            match by_url.iter().position(|p| p.url == pr.url) {
                None => {
                    by_url.push(pr.clone());
                    written.push(pr.clone());
                    mutated = true;
                }
                Some(pos) => {
                    if by_url[pos].source != DetectedPrSource::Created
                        && pr.source == DetectedPrSource::Created
                    {
                        by_url[pos].source = DetectedPrSource::Created;
                        written.push(by_url[pos].clone());
                        mutated = true;
                    }
                }
            }
        }

        if mutated {
            self.db.execute(
                "UPDATE chats SET detected_prs = ? WHERE id = ?",
                rusqlite::params![serde_json::to_string(&by_url)?, chat_id],
            )?;
        }
        Ok(written)
    }

    pub fn get_todos(&self, chat_id: &str) -> Result<Option<Vec<TodoItem>>, DbError> {
        let raw = self.read_text_column("todos", chat_id)?;
        match raw.filter(|s| !s.is_empty()) {
            Some(s) => Ok(Some(serde_json::from_str(&s).unwrap_or_default())),
            None => Ok(None),
        }
    }

    pub fn update_todos(&self, chat_id: &str, todos: &[TodoItem]) -> Result<(), DbError> {
        self.db.execute(
            "UPDATE chats SET todos = ? WHERE id = ?",
            rusqlite::params![serde_json::to_string(todos)?, chat_id],
        )?;
        Ok(())
    }

    /// Forget the CLI session bound to this chat: the next send spawns a fresh
    /// session instead of `--resume`ing a dead id. Used by degraded-chat recovery
    /// ("Continue here") after the CLI's transcript file was deleted.
    /// Opens a `context_reset` segment, so the earlier session's history stays
    /// readable while the mirror (and therefore the next spawn) starts fresh.
    pub fn clear_session(&self, id: &str) -> Result<(), DbError> {
        let tx = self.db.unchecked_transaction()?;
        chat_segments::start_context_reset(&tx, id)?;
        tx.commit()?;
        Ok(())
    }

    /// Detach the chat from its (deleted) worktree so it rebinds to the project root.
    pub fn clear_worktree(&self, id: &str) -> Result<(), DbError> {
        self.db.execute(
            "UPDATE chats SET worktree_path = NULL, branch_name = NULL WHERE id = ?",
            rusqlite::params![id],
        )?;
        Ok(())
    }

    /// Bulk-reset every chat whose process_state is 'working' to 'idle'.
    /// Returns the number of rows affected.
    pub fn reset_working_to_idle(&self) -> Result<i64, DbError> {
        let changes = self.db.execute(
            "UPDATE chats SET process_state = 'idle' WHERE process_state = 'working'",
            [],
        )?;
        Ok(changes as i64)
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
        let sql = format!(
            "SELECT {CHAT_SELECT_FIELDS} FROM chats WHERE id IN (SELECT chat_id FROM \
             chat_native_sessions WHERE native_session_id = ? AND borrowed_from_chat_id IS NULL) \
             AND project_id = ?"
        );
        let mut chats = self.query_chats(&sql, rusqlite::params![session_id, project_id])?;
        match chats.pop() {
            Some(mut chat) => {
                self.populate_tags(&mut chat)?;
                Ok(Some(chat))
            }
            None => Ok(None),
        }
    }

    // pub(crate): reused by `side_chats.rs`'s own SELECT.
    pub(crate) fn query_chats<P: rusqlite::Params>(
        &self,
        sql: &str,
        params: P,
    ) -> Result<Vec<Chat>, DbError> {
        let mut stmt = self.db.prepare(sql)?;
        let mut rows = stmt.query(params)?;
        let mut chats = Vec::new();
        while let Some(row) = rows.next()? {
            chats.push(map_row(row)?);
        }
        Ok(chats)
    }

    fn read_text_column(&self, column: &str, chat_id: &str) -> Result<Option<String>, DbError> {
        // `column` is a hard-coded literal at each call site (never user input).
        let sql = format!("SELECT {column} FROM chats WHERE id = ?");
        Ok(self
            .db
            .query_row(&sql, [chat_id], |row| row.get::<_, Option<String>>(0))
            .optional()?
            .flatten())
    }

    fn populate_bulk_tags(&self, chats: &mut [Chat]) -> Result<(), DbError> {
        let Some(chat_tags) = &self.chat_tags else {
            return Ok(());
        };
        if chats.is_empty() {
            return Ok(());
        }
        let ids: Vec<String> = chats.iter().map(|c| c.id.clone()).collect();
        let tags_by_chat = chat_tags.bulk_for_chats(&ids)?;
        for c in chats.iter_mut() {
            c.tags = Some(tags_by_chat.get(&c.id).cloned().unwrap_or_default());
        }
        Ok(())
    }

    fn populate_tags(&self, chat: &mut Chat) -> Result<(), DbError> {
        let Some(chat_tags) = &self.chat_tags else {
            return Ok(());
        };
        chat.tags = Some(chat_tags.list_for_chat(&chat.id)?);
        Ok(())
    }
}

fn map_row(row: &rusqlite::Row<'_>) -> Result<Chat, DbError> {
    let mut chat = ChatRow::from_row(row)?.into_chat();
    chat.side_chat_id = row.get("sideChatId")?;
    chat.orchestration = crate::orchestration::map_orchestration(row)?;
    Ok(chat)
}

fn parse_todos(value: Option<String>) -> Option<Vec<TodoItem>> {
    parse_json_column(value, None)
}
