use super::{ChatStatus, DisplayStatus, ProcessState, TodoItem};
use crate::{
    adapter::DetectedPr, background_task::BackgroundActivity, context::SessionMention,
    orchestration::ChatOrchestration, settings::ExecutionMode,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chat {
    pub id: String,
    pub adapter_id: String,
    pub project_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claude_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<ExecutionMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_mode: Option<bool>,
    pub status: ChatStatus,
    pub created_at: String,
    pub updated_at: String,
    pub total_cost: f64,
    pub total_tokens_input: i64,
    pub total_tokens_output: i64,
    pub last_context_tokens_input: i64,
    /// Last CLI-reported context usage (`get_context_usage`): tokens in window /
    /// usable window size. Authoritative pair for the meter when no live report
    /// is in memory.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_context_total_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_context_max_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_files: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mentions: Option<Vec<SessionMention>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_files: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_name: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::serde_util::double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub process_state: Option<Option<ProcessState>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_status: Option<DisplayStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_running: Option<bool>,
    /// Live background work (agents/bash/workflows) — derived per response, never
    /// persisted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_activity: Option<BackgroundActivity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_missing: Option<bool>,
    /// Derived per response over the chat's effective working directory
    /// (`worktree_path` when set, otherwise the owning project's path); generalizes
    /// `worktree_missing`, never persisted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub directory_missing: Option<bool>,
    /// The absent directory. Set only when `directory_missing` is true.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing_directory_path: Option<String>,
    /// True when the CLI's transcript file for this session was deleted from disk
    /// (persisted flag).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transcript_missing: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub todos: Option<Vec<TodoItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
    /// Per-chat tuning override. Flattened here, between `pinned` and
    /// `detected_prs`, so `effort`/`fast`/`ultracode`/`adaptiveThinking` keep
    /// their historical position in the serialized object.
    #[serde(flatten)]
    pub tuning: crate::chat::SessionTuning,
    /// PRs detected in the session's tool_results.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detected_prs: Option<Vec<DetectedPr>>,
    /// User-source tags applied to this chat (synthetic chips excluded).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// Set when an automation run's `ask_agent` step created this chat; hides it from the default sessions list.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub automation_run_id: Option<String>,
    /// Fixed at creation. A temporary chat is left out of default listings,
    /// refuses pin/tag/archive/unarchive, and is removed only by an explicit
    /// discard or by removing its project.
    #[serde(default)]
    pub temporary: bool,
    /// Derived on read as `project_id == NO_PROJECT_ID`; never a stored column.
    #[serde(default)]
    pub no_project: bool,
    /// ISO time of the chat's latest vendor-context loss (its stored provider
    /// session was started with no persistence and can no longer be resumed).
    /// Drives the "earlier context was not preserved" notice.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_lost_at: Option<String>,
    /// Whether the stored provider session (`claude_session_id`) was started
    /// with the adapter's no-persistence mechanism, so it is never a resume
    /// target. Daemon-internal — deliberately absent from the wire `Chat`.
    #[serde(skip)]
    pub vendor_session_ephemeral: bool,
    /// Non-project cwd `<data_dir>/scratch/<chatId>`, stored at create so every
    /// cwd consumer can read it off the `Chat`. Daemon-internal — deliberately
    /// absent from the wire `Chat`.
    #[serde(skip)]
    pub scratch_path: Option<String>,
    /// The chat this one was forked from, or `null` for a chat with no parent.
    /// Deliberately generic — never fork-specific in name or
    /// semantics, since side chats reuse it as "temporary and has a
    /// parent". Survives archive/unarchive; never cascades from the parent.
    #[serde(
        default,
        deserialize_with = "crate::serde_util::double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub parent_chat_id: Option<Option<String>>,
    /// Id of this chat's side chat, derived on every read by a
    /// correlated subquery — never a stored column. `None` when this chat has
    /// no side chat, or when this chat is itself a side chat (side chats never
    /// have side chats).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub side_chat_id: Option<String>,
    /// Whether this chat's side chat has a pending permission or question.
    /// Derived alongside `side_chat_id`; set only when `side_chat_id` is
    /// `Some`. Never a stored column.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub side_chat_waiting: Option<bool>,
    /// Agent provenance and delegated-task state (orchestration MCP server).
    #[serde(flatten)]
    pub orchestration: ChatOrchestration,
}
