use super::{
    parse_chat_status, parse_effort, parse_execution_mode, parse_json_array, parse_nullable_bool,
    parse_process_state, parse_todos,
};
use crate::{DbError, sql_types::FromRow};
use mainframe_types::chat::{Chat, NO_PROJECT_ID};

/// The `chats` columns `CHAT_SELECT_FIELDS` reads, as stored (snake_case,
/// integers for booleans, JSON text for arrays). `into_chat` is the one
/// mapping onto the wire `Chat`; derived and enrichment fields are filled by
/// the caller.
pub(crate) struct ChatRow {
    id: String,
    adapter_id: String,
    project_id: String,
    title: Option<String>,
    claude_session_id: Option<String>,
    session_file_path: Option<String>,
    model: Option<String>,
    permission_mode: Option<String>,
    plan_mode: i64,
    status: String,
    created_at: String,
    updated_at: String,
    total_cost: f64,
    total_tokens_input: i64,
    total_tokens_output: i64,
    last_context_tokens_input: i64,
    last_context_total_tokens: Option<i64>,
    last_context_max_tokens: Option<i64>,
    mentions: Option<String>,
    modified_files: Option<String>,
    worktree_path: Option<String>,
    branch_name: Option<String>,
    process_state: Option<String>,
    transcript_missing: Option<i64>,
    todos: Option<String>,
    pinned: Option<i64>,
    effort: Option<String>,
    fast: Option<i64>,
    ultracode: Option<i64>,
    adaptive_thinking: Option<i64>,
    detected_prs: Option<String>,
    automation_run_id: Option<String>,
    temporary: i64,
    context_lost_at: Option<String>,
    vendor_session_ephemeral: Option<i64>,
    scratch_path: Option<String>,
    parent_chat_id: Option<String>,
}

impl FromRow for ChatRow {
    type Error = DbError;
    fn from_row(row: &rusqlite::Row<'_>) -> Result<Self, DbError> {
        Ok(Self {
            id: row.get("id")?,
            adapter_id: row.get("adapter_id")?,
            project_id: row.get("project_id")?,
            title: row.get("title")?,
            claude_session_id: row.get("claude_session_id")?,
            session_file_path: row.get("session_file_path")?,
            model: row.get("model")?,
            permission_mode: row.get("permission_mode")?,
            plan_mode: row.get("plan_mode")?,
            status: row.get("status")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            total_cost: row.get("total_cost")?,
            total_tokens_input: row.get("total_tokens_input")?,
            total_tokens_output: row.get("total_tokens_output")?,
            last_context_tokens_input: row.get("last_context_tokens_input")?,
            last_context_total_tokens: row.get("last_context_total_tokens")?,
            last_context_max_tokens: row.get("last_context_max_tokens")?,
            mentions: row.get("mentions")?,
            modified_files: row.get("modified_files")?,
            worktree_path: row.get("worktree_path")?,
            branch_name: row.get("branch_name")?,
            process_state: row.get("process_state")?,
            transcript_missing: row.get("transcript_missing")?,
            todos: row.get("todos")?,
            pinned: row.get("pinned")?,
            effort: row.get("effort")?,
            fast: row.get("fast")?,
            ultracode: row.get("ultracode")?,
            adaptive_thinking: row.get("adaptive_thinking")?,
            detected_prs: row.get("detected_prs")?,
            automation_run_id: row.get("automation_run_id")?,
            temporary: row.get("temporary")?,
            context_lost_at: row.get("context_lost_at")?,
            vendor_session_ephemeral: row.get("vendor_session_ephemeral")?,
            scratch_path: row.get("scratch_path")?,
            parent_chat_id: row.get("parent_chat_id")?,
        })
    }
}

impl ChatRow {
    pub(super) fn into_chat(self) -> Chat {
        let no_project = self.project_id == NO_PROJECT_ID;
        Chat {
            id: self.id,
            adapter_id: self.adapter_id,
            project_id: self.project_id,
            title: self.title,
            claude_session_id: self.claude_session_id,
            session_file_path: self.session_file_path,
            model: self.model,
            permission_mode: parse_execution_mode(self.permission_mode),
            plan_mode: Some(self.plan_mode != 0),
            status: parse_chat_status(self.status),
            created_at: self.created_at,
            updated_at: self.updated_at,
            total_cost: self.total_cost,
            total_tokens_input: self.total_tokens_input,
            total_tokens_output: self.total_tokens_output,
            last_context_tokens_input: self.last_context_tokens_input,
            last_context_total_tokens: self.last_context_total_tokens.map(|n| n as u64),
            last_context_max_tokens: self.last_context_max_tokens.map(|n| n as u64),
            mentions: Some(parse_json_array(self.mentions)),
            modified_files: Some(parse_json_array(self.modified_files)),
            worktree_path: self.worktree_path.filter(|s| !s.is_empty()),
            branch_name: self.branch_name.filter(|s| !s.is_empty()),
            process_state: Some(parse_process_state(self.process_state)),
            transcript_missing: Some(self.transcript_missing.is_some_and(|n| n != 0)),
            todos: parse_todos(self.todos),
            pinned: Some(self.pinned.is_some_and(|n| n != 0)),
            tuning: mainframe_types::chat::SessionTuning {
                effort: parse_effort(self.effort).map(Some),
                fast: parse_nullable_bool(self.fast),
                ultracode: parse_nullable_bool(self.ultracode),
                adaptive_thinking: parse_nullable_bool(self.adaptive_thinking),
            },
            detected_prs: Some(parse_json_array(self.detected_prs)),
            automation_run_id: self.automation_run_id,
            temporary: self.temporary != 0,
            no_project,
            context_lost_at: self.context_lost_at,
            vendor_session_ephemeral: self.vendor_session_ephemeral.is_some_and(|n| n != 0),
            scratch_path: self.scratch_path,
            parent_chat_id: Some(self.parent_chat_id),
            ..Chat::default()
        }
    }
}
