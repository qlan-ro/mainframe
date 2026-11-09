mod fork_input;
mod fork_insert;
mod json_columns;
mod query;
mod row;

pub use fork_input::ForkCreateInput;
pub use query::ChatListFilters;

use std::rc::Rc;

use mainframe_types::adapter::{EffortLevel, ForkSource};
use mainframe_types::chat::{Chat, NO_PROJECT_ID, NewChat};
use mainframe_types::chat_patch::ChatPatch;
use mainframe_types::segment::ForkPlan;
use mainframe_types::settings::ExecutionMode;
use mainframe_types::time::now_iso8601;
use rusqlite::Connection;
use rusqlite::types::Value as SqlValue;
use serde::{Deserialize, Serialize};

use crate::DbError;
use crate::chat_assignments::assignments;
use crate::chat_native_sessions::NativePatch;
use crate::chat_segments;
use crate::chat_tags::ChatTagsRepository;
use fork_insert::insert_fork_row;

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
/// chat by `ChatManager::fork_chat`. Tags and pin state are deliberately
/// absent: the fork inherits neither.
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

pub struct ChatsRepository {
    // pub(crate): reused by `side_chats.rs`'s find-then-insert.
    pub(crate) db: Rc<Connection>,
    chat_tags: ChatTagsRepository,
}

impl ChatsRepository {
    pub fn new(db: Rc<Connection>) -> Self {
        let chat_tags = ChatTagsRepository::new(Rc::clone(&db));
        Self { db, chat_tags }
    }

    /// Reads back a row this repository just inserted. Every insert path
    /// returns its `Chat` through here, so the value a caller emits as
    /// `chat.created` comes from the same `map_row` mapping as every later
    /// read and carries the same keys.
    pub(crate) fn get_inserted(&self, id: &str) -> Result<Chat, DbError> {
        self.get(id)?
            .ok_or_else(|| DbError::Invariant(format!("chat {id} insert did not round-trip")))
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
        chat_segments::ensure_seeded(&tx, &id)?;

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
        let tx = self.db.unchecked_transaction()?;
        insert_fork_row(&tx, insert, &id, &now)?;
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

    /// Session columns (`vendor_session_id`, `session_file_path`, context
    /// usage, `transcript_missing`, adapter and model) are routed through the
    /// segment repository first, in the same transaction, so the `chats`
    /// mirror and the active native-session row never disagree.
    pub fn update(&self, id: &str, updates: &ChatPatch) -> Result<(), DbError> {
        let tx = self.db.unchecked_transaction()?;
        if let Some(native_id) = &updates.vendor_session_id {
            chat_segments::record_native_id(
                &tx,
                id,
                native_id,
                updates.session_file_path.as_deref(),
            )?;
        }
        chat_segments::absorb_chat_patch(&tx, id, &native_patch(updates))?;
        update_columns(&tx, id, updates)?;
        tx.commit()?;
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
}

fn update_columns(db: &Connection, id: &str, updates: &ChatPatch) -> Result<(), DbError> {
    let (columns, mut values) = assignments(updates)?;
    if columns.is_empty() {
        return Ok(());
    }
    values.push(SqlValue::Text(id.to_string()));
    let sets: Vec<String> = columns.iter().map(|c| format!("{c} = ?")).collect();
    let sql = format!("UPDATE chats SET {} WHERE id = ?", sets.join(", "));
    db.execute(&sql, rusqlite::params_from_iter(values))?;
    Ok(())
}
