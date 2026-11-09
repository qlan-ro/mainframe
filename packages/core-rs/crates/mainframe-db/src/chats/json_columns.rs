//! The JSON list columns on `chats` (mentions, plan and skill files, detected
//! PRs, todos, dismissed worktrees) and the daemon-internal pending fork.
//! Each add is a read-modify-write; the DB worker runs one job at a time, so
//! none interleave.

use mainframe_types::adapter::{DetectedPr, DetectedPrSource};
use mainframe_types::chat::TodoItem;
use mainframe_types::context::{SessionMention, SkillFileEntry};
use rusqlite::OptionalExtension;
use serde::Serialize;
use serde_json::Value;

use super::row::parse_json_array;
use super::{ChatsRepository, PendingFork};
use crate::DbError;

impl ChatsRepository {
    pub fn get_mentions(&self, chat_id: &str) -> Result<Vec<SessionMention>, DbError> {
        let raw = self.read_text_column("mentions", chat_id)?;
        Ok(parse_json_array(raw))
    }

    pub fn add_mention(&self, chat_id: &str, mention: &SessionMention) -> Result<bool, DbError> {
        let existing = self.get_mentions(chat_id)?;
        self.append_unique("mentions", chat_id, existing, mention.clone(), |m| {
            m.kind == mention.kind && m.name == mention.name && m.path == mention.path
        })
    }

    pub fn get_plan_files(&self, chat_id: &str) -> Result<Vec<String>, DbError> {
        let raw = self.read_text_column("plan_files", chat_id)?;
        Ok(parse_json_array(raw))
    }

    pub fn add_plan_file(&self, chat_id: &str, file_path: &str) -> Result<bool, DbError> {
        let existing = self.get_plan_files(chat_id)?;
        self.append_unique(
            "plan_files",
            chat_id,
            existing,
            file_path.to_string(),
            |p| p == file_path,
        )
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
        let existing = self.get_dismissed_worktrees(chat_id)?;
        let path = worktree_path.to_string();
        self.append_unique("dismissed_worktrees", chat_id, existing, path, |p| {
            p == worktree_path
        })
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

    /// Entries are stored as `{path, displayName}` objects (older rows hold
    /// bare path strings); the display name is always derived from the path.
    pub fn get_skill_files(&self, chat_id: &str) -> Result<Vec<SkillFileEntry>, DbError> {
        let raw = self.read_text_column("skill_files", chat_id)?;
        let entries: Vec<Value> = parse_json_array(raw);
        Ok(entries.into_iter().map(skill_file_entry).collect())
    }

    pub fn add_skill_file(&self, chat_id: &str, entry: &SkillFileEntry) -> Result<bool, DbError> {
        let existing = self.get_skill_files(chat_id)?;
        self.append_unique("skill_files", chat_id, existing, entry.clone(), |e| {
            e.path == entry.path
        })
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
            self.write_json_column("detected_prs", chat_id, &by_url)?;
        }
        Ok(written)
    }

    pub fn update_todos(&self, chat_id: &str, todos: &[TodoItem]) -> Result<(), DbError> {
        self.write_json_column("todos", chat_id, todos)
    }

    /// Appends `item` to the list stored in `column` unless an entry already
    /// matches `is_duplicate`. Returns whether it wrote.
    fn append_unique<T: Serialize>(
        &self,
        column: &str,
        chat_id: &str,
        mut existing: Vec<T>,
        item: T,
        is_duplicate: impl Fn(&T) -> bool,
    ) -> Result<bool, DbError> {
        if existing.iter().any(is_duplicate) {
            return Ok(false);
        }
        existing.push(item);
        self.write_json_column(column, chat_id, &existing)?;
        Ok(true)
    }

    // `column` is a hard-coded literal at each call site (never user input).
    fn write_json_column<T: Serialize + ?Sized>(
        &self,
        column: &str,
        chat_id: &str,
        value: &T,
    ) -> Result<(), DbError> {
        let sql = format!("UPDATE chats SET {column} = ? WHERE id = ?");
        self.db.execute(
            &sql,
            rusqlite::params![serde_json::to_string(value)?, chat_id],
        )?;
        Ok(())
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
}

/// `.../<name>/SKILL.md` displays as `<name>`; any other file as its file name.
fn skill_file_entry(entry: Value) -> SkillFileEntry {
    let path = match entry {
        Value::String(path) => path,
        other => other
            .get("path")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
    };
    let mut parts = path.rsplit('/');
    let file = parts.next().unwrap_or_default();
    let display_name = match parts.next() {
        Some(dir) if file == "SKILL.md" => dir,
        _ => file,
    }
    .to_string();
    SkillFileEntry { path, display_name }
}
