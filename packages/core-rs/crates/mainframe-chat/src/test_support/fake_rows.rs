//! The rows the fake store synthesizes the way the repository would.

use mainframe_types::chat::{Chat, ChatStatus};

use crate::chat_manager::ForkCreateInput;
use crate::test_support::test_chat;

/// The row `create_fork` inserts: the fork's config copied from `insert`.
pub(crate) fn fork_row(id: &str, insert: &ForkCreateInput) -> Chat {
    let mut chat = test_chat(id);
    chat.adapter_id = insert.adapter_id.clone();
    chat.project_id = insert.project_id.clone();
    chat.title = insert.title.clone();
    chat.model = insert.model.clone();
    chat.permission_mode = insert.permission_mode;
    chat.plan_mode = Some(insert.plan_mode);
    chat.status = ChatStatus::Active;
    chat.created_at = "2026-01-01T00:00:00.000Z".to_string();
    chat.updated_at = "2026-01-01T00:00:00.000Z".to_string();
    chat.worktree_path = insert.worktree_path.clone();
    chat.branch_name = insert.branch_name.clone();
    chat.tuning = mainframe_types::chat::SessionTuning {
        effort: Some(insert.effort),
        fast: Some(insert.fast),
        ultracode: Some(insert.ultracode),
        adaptive_thinking: Some(insert.adaptive_thinking),
    };
    chat.parent_chat_id = Some(Some(insert.parent_chat_id.clone()));
    chat
}

/// The temporary side-chat row the repository creates under `parent`.
pub(crate) fn side_chat_row(id: &str, parent: &Chat) -> Chat {
    let now = "2026-01-01T00:00:00.000Z".to_string();
    let mut chat = test_chat(id);
    chat.adapter_id = parent.adapter_id.clone();
    chat.project_id = parent.project_id.clone();
    chat.model = parent.model.clone();
    chat.permission_mode = parent.permission_mode;
    chat.plan_mode = parent.plan_mode;
    chat.created_at = now.clone();
    chat.updated_at = now;
    chat.worktree_path = parent.worktree_path.clone();
    chat.branch_name = parent.branch_name.clone();
    chat.temporary = true;
    chat.no_project = parent.no_project;
    chat.scratch_path = parent.scratch_path.clone();
    chat.parent_chat_id = Some(Some(parent.id.clone()));
    chat
}

pub(crate) fn owned_sessions(
    store: &dyn crate::segments::SegmentStore,
    chat_id: &str,
) -> Vec<crate::config_transcripts::OwnedNativeSession> {
    store
        .layout(chat_id)
        .into_iter()
        .flat_map(|l| l.natives)
        .filter(|n| n.borrowed_from_chat_id.is_none())
        .filter_map(|n| {
            Some(crate::config_transcripts::OwnedNativeSession {
                session_id: n.native_session_id?,
                native_ref: n.id,
                adapter_id: n.adapter_id,
            })
        })
        .collect()
}
