//! Ported from `packages/core/src/db/chats.ts`.

use std::rc::Rc;

use mainframe_runtime::time::now_iso8601;
use mainframe_types::adapter::{DetectedPr, DetectedPrSource, EffortLevel};
use mainframe_types::chat::{Chat, ChatStatus, ProcessState, TodoItem};
use mainframe_types::context::{SessionMention, SkillFileEntry};
use mainframe_types::settings::ExecutionMode;
use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, OptionalExtension};
use serde_json::Value;

use crate::chat_tags::ChatTagsRepository;
use crate::{DbError, enum_to_db_string};

const CHAT_SELECT_FIELDS: &str = "id, adapter_id as adapterId, project_id as projectId, \
  title, claude_session_id as claudeSessionId, model, \
  permission_mode as permissionMode, status, \
  created_at as createdAt, updated_at as updatedAt, \
  total_cost as totalCost, total_tokens_input as totalTokensInput, \
  total_tokens_output as totalTokensOutput, last_context_tokens_input as lastContextTokensInput, \
  mentions, modified_files as modifiedFiles, \
  worktree_path as worktreePath, branch_name as branchName, \
  process_state as processState, todos, pinned, effort, \
  plan_mode as planMode, detected_prs as detectedPrs, \
  session_file_path as sessionFilePath, \
  fast, ultracode, adaptive_thinking";

#[derive(Debug, Clone, Default)]
pub struct ChatListFilters {
    pub project_id: Option<String>,
    pub tags_all: Option<Vec<String>>,
    pub has_worktree: bool,
    pub include_archived: bool,
}

/// Partial-update payload mirroring the TS `update(id, updates: Partial<Chat>)`.
/// A `None` outer field means "not part of this update" (skipped). The six
/// clearable columns use `Option<Option<T>>`: inner `None` writes SQL NULL
/// (the `?? null` transforms in `updateColumnMap`).
#[derive(Debug, Clone, Default)]
pub struct ChatUpdate {
    pub adapter_id: Option<String>,
    pub model: Option<String>,
    pub claude_session_id: Option<String>,
    pub session_file_path: Option<String>,
    pub status: Option<ChatStatus>,
    pub total_cost: Option<f64>,
    pub total_tokens_input: Option<i64>,
    pub total_tokens_output: Option<i64>,
    pub last_context_tokens_input: Option<i64>,
    pub title: Option<String>,
    pub permission_mode: Option<ExecutionMode>,
    pub worktree_path: Option<Option<String>>,
    pub branch_name: Option<Option<String>>,
    pub mentions: Option<Vec<SessionMention>>,
    pub process_state: Option<Option<ProcessState>>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub pinned: Option<bool>,
    pub effort: Option<Option<EffortLevel>>,
    pub fast: Option<Option<bool>>,
    pub ultracode: Option<Option<bool>>,
    pub adaptive_thinking: Option<Option<bool>>,
    pub plan_mode: Option<bool>,
}

const VALID_EFFORTS: [&str; 7] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

fn parse_effort(value: Option<String>) -> Option<EffortLevel> {
    let value = value?;
    if VALID_EFFORTS.contains(&value.as_str()) {
        serde_json::from_value(Value::String(value)).ok()
    } else {
        None
    }
}

/// `v == null ? null : Boolean(v)` — the tri-state stays present (never absent).
fn parse_nullable_bool(v: Option<i64>) -> Option<Option<bool>> {
    Some(v.map(|n| n != 0))
}

fn parse_execution_mode(value: Option<String>) -> Option<ExecutionMode> {
    value
        .filter(|s| !s.is_empty())
        .and_then(|s| serde_json::from_value(Value::String(s)).ok())
}

fn parse_process_state(value: Option<String>) -> Option<ProcessState> {
    value
        .filter(|s| !s.is_empty())
        .and_then(|s| serde_json::from_value(Value::String(s)).ok())
}

fn parse_chat_status(value: String) -> ChatStatus {
    serde_json::from_value(Value::String(value)).unwrap_or(ChatStatus::Active)
}

fn parse_json_column<T>(value: Option<String>, fallback: T) -> T
where
    T: serde::de::DeserializeOwned,
{
    match value.filter(|s| !s.is_empty()) {
        // expected: malformed stored JSON column, fall back
        Some(s) => serde_json::from_str(&s).unwrap_or(fallback),
        None => fallback,
    }
}

fn parse_json_array<T>(value: Option<String>) -> Vec<T>
where
    T: serde::de::DeserializeOwned,
{
    parse_json_column(value, Vec::new())
}

fn opt_text(v: &Option<String>) -> SqlValue {
    match v {
        Some(s) => SqlValue::Text(s.clone()),
        None => SqlValue::Null,
    }
}

fn nullable_bool_value(v: &Option<bool>) -> SqlValue {
    match v {
        Some(b) => SqlValue::Integer(i64::from(*b)),
        None => SqlValue::Null,
    }
}

pub struct ChatsRepository {
    db: Rc<Connection>,
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

    pub fn create(
        &self,
        project_id: &str,
        adapter_id: &str,
        model: Option<&str>,
        permission_mode: Option<&str>,
    ) -> Result<Chat, DbError> {
        let id = nanoid::nanoid!();
        let now = now_iso8601();
        // `model || null` / `permissionMode || null` — empty string binds NULL.
        let model_bind = model.filter(|s| !s.is_empty());
        let permission_bind = permission_mode.filter(|s| !s.is_empty());

        self.db.execute(
            "INSERT INTO chats (id, adapter_id, project_id, model, permission_mode, status, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
            rusqlite::params![id, adapter_id, project_id, model_bind, permission_bind, now, now],
        )?;

        Ok(Chat {
            id,
            adapter_id: adapter_id.to_string(),
            project_id: project_id.to_string(),
            title: None,
            claude_session_id: None,
            session_file_path: None,
            model: model.map(str::to_string),
            permission_mode: parse_execution_mode(permission_mode.map(str::to_string)),
            plan_mode: Some(false),
            status: ChatStatus::Active,
            created_at: now.clone(),
            updated_at: now,
            total_cost: 0.0,
            total_tokens_input: 0,
            total_tokens_output: 0,
            last_context_tokens_input: 0,
            context_files: None,
            mentions: None,
            modified_files: None,
            worktree_path: None,
            branch_name: None,
            process_state: None,
            display_status: None,
            is_running: None,
            worktree_missing: None,
            todos: None,
            pinned: None,
            effort: None,
            fast: None,
            ultracode: None,
            adaptive_thinking: None,
            detected_prs: None,
            tags: None,
        })
    }

    pub fn update(&self, id: &str, updates: &ChatUpdate) -> Result<(), DbError> {
        let mut sets: Vec<&str> = Vec::new();
        let mut values: Vec<SqlValue> = Vec::new();

        // Order mirrors ChatsRepository.updateColumnMap.
        if let Some(v) = &updates.adapter_id {
            sets.push("adapter_id = ?");
            values.push(SqlValue::Text(v.clone()));
        }
        if let Some(v) = &updates.model {
            sets.push("model = ?");
            values.push(SqlValue::Text(v.clone()));
        }
        if let Some(v) = &updates.claude_session_id {
            sets.push("claude_session_id = ?");
            values.push(SqlValue::Text(v.clone()));
        }
        if let Some(v) = &updates.session_file_path {
            sets.push("session_file_path = ?");
            values.push(SqlValue::Text(v.clone()));
        }
        if let Some(v) = &updates.status {
            sets.push("status = ?");
            values.push(SqlValue::Text(enum_to_db_string(v)?));
        }
        if let Some(v) = updates.total_cost {
            sets.push("total_cost = ?");
            values.push(SqlValue::Real(v));
        }
        if let Some(v) = updates.total_tokens_input {
            sets.push("total_tokens_input = ?");
            values.push(SqlValue::Integer(v));
        }
        if let Some(v) = updates.total_tokens_output {
            sets.push("total_tokens_output = ?");
            values.push(SqlValue::Integer(v));
        }
        if let Some(v) = updates.last_context_tokens_input {
            sets.push("last_context_tokens_input = ?");
            values.push(SqlValue::Integer(v));
        }
        if let Some(v) = &updates.title {
            sets.push("title = ?");
            values.push(SqlValue::Text(v.clone()));
        }
        if let Some(v) = &updates.permission_mode {
            sets.push("permission_mode = ?");
            values.push(SqlValue::Text(enum_to_db_string(v)?));
        }
        if let Some(v) = &updates.worktree_path {
            sets.push("worktree_path = ?");
            values.push(opt_text(v));
        }
        if let Some(v) = &updates.branch_name {
            sets.push("branch_name = ?");
            values.push(opt_text(v));
        }
        if let Some(v) = &updates.mentions {
            sets.push("mentions = ?");
            values.push(SqlValue::Text(serde_json::to_string(v)?));
        }
        if let Some(v) = &updates.process_state {
            sets.push("process_state = ?");
            values.push(match v {
                Some(ps) => SqlValue::Text(enum_to_db_string(ps)?),
                None => SqlValue::Null,
            });
        }
        if let Some(v) = &updates.created_at {
            sets.push("created_at = ?");
            values.push(SqlValue::Text(v.clone()));
        }
        if let Some(v) = &updates.updated_at {
            sets.push("updated_at = ?");
            values.push(SqlValue::Text(v.clone()));
        }
        if let Some(v) = updates.pinned {
            sets.push("pinned = ?");
            values.push(SqlValue::Integer(i64::from(v)));
        }
        if let Some(v) = &updates.effort {
            sets.push("effort = ?");
            values.push(match v {
                Some(e) => SqlValue::Text(enum_to_db_string(e)?),
                None => SqlValue::Null,
            });
        }
        if let Some(v) = &updates.fast {
            sets.push("fast = ?");
            values.push(nullable_bool_value(v));
        }
        if let Some(v) = &updates.ultracode {
            sets.push("ultracode = ?");
            values.push(nullable_bool_value(v));
        }
        if let Some(v) = &updates.adaptive_thinking {
            sets.push("adaptive_thinking = ?");
            values.push(nullable_bool_value(v));
        }
        if let Some(v) = updates.plan_mode {
            sets.push("plan_mode = ?");
            values.push(SqlValue::Integer(i64::from(v)));
        }

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
            .prepare("SELECT claude_session_id FROM chats WHERE project_id = ? AND claude_session_id IS NOT NULL")?;
        let rows = stmt.query_map([project_id], |row| row.get::<_, String>(0))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn find_by_external_session_id(
        &self,
        session_id: &str,
        project_id: &str,
    ) -> Result<Option<Chat>, DbError> {
        let sql = format!(
            "SELECT {CHAT_SELECT_FIELDS} FROM chats WHERE claude_session_id = ? AND project_id = ?"
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

    fn query_chats<P: rusqlite::Params>(&self, sql: &str, params: P) -> Result<Vec<Chat>, DbError> {
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
    Ok(Chat {
        id: row.get("id")?,
        adapter_id: row.get("adapterId")?,
        project_id: row.get("projectId")?,
        title: row.get("title")?,
        claude_session_id: row.get("claudeSessionId")?,
        session_file_path: row.get("sessionFilePath")?,
        model: row.get("model")?,
        permission_mode: parse_execution_mode(row.get::<_, Option<String>>("permissionMode")?),
        plan_mode: Some(row.get::<_, i64>("planMode")? != 0),
        status: parse_chat_status(row.get::<_, String>("status")?),
        created_at: row.get("createdAt")?,
        updated_at: row.get("updatedAt")?,
        total_cost: row.get("totalCost")?,
        total_tokens_input: row.get("totalTokensInput")?,
        total_tokens_output: row.get("totalTokensOutput")?,
        last_context_tokens_input: row.get("lastContextTokensInput")?,
        context_files: None,
        mentions: Some(parse_json_array(row.get::<_, Option<String>>("mentions")?)),
        modified_files: Some(parse_json_array(
            row.get::<_, Option<String>>("modifiedFiles")?,
        )),
        worktree_path: row
            .get::<_, Option<String>>("worktreePath")?
            .filter(|s| !s.is_empty()),
        branch_name: row
            .get::<_, Option<String>>("branchName")?
            .filter(|s| !s.is_empty()),
        process_state: Some(parse_process_state(
            row.get::<_, Option<String>>("processState")?,
        )),
        display_status: None,
        is_running: None,
        worktree_missing: None,
        todos: parse_todos(row.get::<_, Option<String>>("todos")?),
        pinned: Some(row.get::<_, Option<i64>>("pinned")?.is_some_and(|n| n != 0)),
        effort: parse_effort(row.get::<_, Option<String>>("effort")?).map(Some),
        fast: parse_nullable_bool(row.get::<_, Option<i64>>("fast")?),
        ultracode: parse_nullable_bool(row.get::<_, Option<i64>>("ultracode")?),
        adaptive_thinking: parse_nullable_bool(row.get::<_, Option<i64>>("adaptive_thinking")?),
        detected_prs: Some(parse_json_array(
            row.get::<_, Option<String>>("detectedPrs")?,
        )),
        tags: None,
    })
}

fn parse_todos(value: Option<String>) -> Option<Vec<TodoItem>> {
    let value = value.filter(|s| !s.is_empty())?;
    serde_json::from_str(&value).ok()
}

// PORT STATUS: src/db/chats.ts (373 lines)
// confidence: high
// notes: CHAT_SELECT_FIELDS aliases every column to camelCase, read by that name.
// mapRow's tri-state fields follow the types crate: processState/fast/ultracode/
// adaptiveThinking are always present (Some(None) for NULL → serializes null);
// effort uses .map(Some) so an invalid/absent value stays absent (None); todos
// falls back to None (absent). parseJsonColumn is defensive (unwrap_or fallback,
// never a propagating from_str) per §3. Partial<Chat> becomes ChatUpdate: outer
// None = skip, and the six `?? null`-transform columns use Option<Option<T>> to
// clear. update() preserves updateColumnMap's exact column order. transactions
// are not needed here (all single-statement). Tests in tests/chats.rs +
// tests/chats_tags.rs.
// todos: 0
