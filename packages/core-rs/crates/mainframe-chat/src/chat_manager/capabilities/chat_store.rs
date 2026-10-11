use super::*;
use crate::config_transcripts::OwnedNativeSession;

pub trait ChatStore: Send + Sync {
    fn owned_native_sessions(&self, chat_id: &str) -> Vec<OwnedNativeSession> {
        let Some(layout) = self.segment_store().and_then(|s| s.layout(chat_id)) else {
            return Vec::new();
        };
        layout
            .natives
            .into_iter()
            .filter(|n| n.borrowed_from_chat_id.is_none())
            .filter_map(|n| {
                Some(OwnedNativeSession {
                    session_id: n.native_session_id?,
                    native_ref: n.id,
                    adapter_id: n.adapter_id,
                })
            })
            .collect()
    }
    fn set_native_session_file_path(&self, native_ref: &str, path: &str) {
        if let Some(store) = self.segment_store() {
            store.set_session_file_path(native_ref, path);
        }
    }

    fn chats_get(&self, id: &str) -> Option<Chat>;

    fn chats_create(&self, new_chat: &NewChat) -> Chat;

    fn chats_delete(&self, chat_id: &str);

    fn chats_update(&self, chat_id: &str, patch: &ChatPatch);

    fn chats_list(&self, project_id: &str) -> Vec<Chat>;

    fn chats_list_all(&self) -> Vec<Chat>;

    fn chats_list_filtered(
        &self,
        project_id: Option<&str>,
        tags_all: Option<&[String]>,
        has_worktree: bool,
        include_archived: bool,
        include_temporary: bool,
    ) -> Vec<Chat>;

    fn chats_reset_working_to_idle(&self) -> i64;

    fn chats_add_mention(&self, chat_id: &str, mention: &SessionMention);

    fn add_plan_file(&self, chat_id: &str, file_path: &str) -> bool;

    fn add_skill_file(&self, chat_id: &str, entry: &SkillFileEntry) -> bool;

    fn update_todos(&self, chat_id: &str, todos: &[TodoItem]);

    fn add_detected_prs(&self, chat_id: &str, prs: &[DetectedPr]) -> Vec<DetectedPr>;

    fn get_dismissed_worktrees(&self, _chat_id: &str) -> Vec<String> {
        Vec::new()
    }

    fn add_dismissed_worktree(&self, _chat_id: &str, _worktree_path: &str) -> bool {
        false
    }

    fn chats_clear_session(&self, chat_id: &str);

    fn chats_clear_worktree(&self, chat_id: &str);

    fn mark_context_lost(&self, chat_id: &str, context_lost_at: &str);

    fn create_fork(&self, insert: &ForkCreateInput) -> Result<Chat, SeamError> {
        let _ = insert;
        Err(SeamError::msg(
            "fork creation is not supported by this ChatManagerDeps",
        ))
    }

    fn get_pending_fork(&self, chat_id: &str) -> Option<PendingForkState> {
        let _ = chat_id;
        None
    }

    fn clear_pending_fork(&self, chat_id: &str) {
        let _ = chat_id;
    }

    fn chats_find_or_create_side_chat(&self, parent: &Chat) -> Result<(Chat, bool), SeamError>;

    fn segment_store(&self) -> Option<&dyn crate::segments::SegmentStore> {
        None
    }
}
