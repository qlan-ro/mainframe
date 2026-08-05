//! Shared update types: `ProcessedAttachments` and the unified `ChatUpdate` patch.
use super::*;

/// Result of `processAttachments` (attachment-processor.ts is a separate port
/// target; the shape is mirrored here for the sendMessage seam).
#[derive(Debug, Clone, Default)]
pub struct ProcessedAttachments {
    pub images: Vec<ImageInput>,
    pub message_content: Vec<MessageContent>,
    pub text_prefix: Vec<String>,
    /// Opaque preview objects (`attachmentPreviews`), stored as JSON for the
    /// transient metadata; their shape is owned by the attachment layer.
    pub attachment_previews: Vec<serde_json::Value>,
}

/// Unified `db.chats.update` patch (superset of the sub-manager patch structs).
/// Tri-state fields use `Some(None)` for an explicit null.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ChatUpdate {
    pub adapter_id: Option<String>,
    pub model: Option<String>,
    pub permission_mode: Option<mainframe_types::settings::ExecutionMode>,
    pub plan_mode: Option<bool>,
    pub claude_session_id: Option<String>,
    pub session_file_path: Option<String>,
    pub worktree_path: Option<Option<String>>,
    pub branch_name: Option<Option<String>>,
    pub total_cost: Option<f64>,
    pub total_tokens_input: Option<i64>,
    pub total_tokens_output: Option<i64>,
    pub last_context_tokens_input: Option<i64>,
    pub last_context_total_tokens: Option<u64>,
    pub last_context_max_tokens: Option<u64>,
    pub process_state: Option<Option<ProcessState>>,
    pub updated_at: Option<String>,
    pub title: Option<String>,
    pub status: Option<mainframe_types::chat::ChatStatus>,
    pub transcript_missing: Option<bool>,
}

impl From<&EventChatUpdate> for ChatUpdate {
    fn from(e: &EventChatUpdate) -> Self {
        ChatUpdate {
            claude_session_id: e.claude_session_id.clone(),
            session_file_path: e.session_file_path.clone(),
            plan_mode: e.plan_mode,
            total_cost: e.total_cost,
            total_tokens_input: e.total_tokens_input,
            total_tokens_output: e.total_tokens_output,
            last_context_tokens_input: e.last_context_tokens_input,
            last_context_total_tokens: e.last_context_total_tokens,
            last_context_max_tokens: e.last_context_max_tokens,
            process_state: e.process_state,
            updated_at: e.updated_at.clone(),
            ..Default::default()
        }
    }
}

impl From<&LifecycleChatUpdate> for ChatUpdate {
    fn from(l: &LifecycleChatUpdate) -> Self {
        ChatUpdate {
            worktree_path: l.worktree_path.clone(),
            branch_name: l.branch_name.clone(),
            plan_mode: l.plan_mode,
            title: l.title.clone(),
            status: l.status,
            ..Default::default()
        }
    }
}
