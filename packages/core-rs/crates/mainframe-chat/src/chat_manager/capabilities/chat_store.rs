use super::*;
use crate::config_transcripts::OwnedNativeSession;

pub trait ChatStore: Send + Sync {
    fn idle_markers(&self, _chat_id: &str) -> Result<Vec<ChatMessage>, SeamError> {
        Ok(Vec::new())
    }

    fn idle_commands(
        &self,
        _chat_id: &str,
    ) -> Result<Vec<mainframe_types::compaction::NativeCompactionRequest>, SeamError> {
        Ok(Vec::new())
    }

    fn idle_queue_put(
        &self,
        _chat_id: &str,
        _input: &mainframe_db::idle_compaction_queue::QueuedInput,
    ) -> Result<(), SeamError> {
        Err(SeamError::msg("maintenance queue unavailable"))
    }
    fn idle_queue_list(
        &self,
        _chat_id: &str,
    ) -> Result<Vec<mainframe_db::idle_compaction_queue::QueuedInput>, SeamError> {
        Ok(Vec::new())
    }
    fn idle_queue_remove(&self, _chat_id: &str, _uuid: &str) -> Result<bool, SeamError> {
        Ok(false)
    }

    fn idle_run_begin(&self, _chat_id: &str, _generation: &str) -> Result<(), SeamError> {
        Ok(())
    }
    fn idle_run_complete(
        &self,
        _chat_id: &str,
        _generation: &str,
        _at: Option<i64>,
    ) -> Result<(), SeamError> {
        Ok(())
    }
    fn idle_run_get(
        &self,
        _chat_id: &str,
    ) -> Result<Option<mainframe_db::idle_compaction::RealRun>, SeamError> {
        Ok(None)
    }
    fn idle_run_claim(
        &self,
        _chat_id: &str,
        _generation: &str,
        _request: &mainframe_types::compaction::NativeCompactionRequest,
    ) -> Result<bool, SeamError> {
        Ok(false)
    }
    fn idle_record(
        &self,
        _chat_id: &str,
        _metadata: &mainframe_types::compaction::CompactionMetadata,
    ) -> Result<bool, SeamError> {
        Ok(false)
    }
    fn idle_provenance(
        &self,
        _chat_id: &str,
    ) -> Result<Vec<mainframe_types::compaction::CompactionMetadata>, SeamError> {
        Ok(Vec::new())
    }

    fn owned_native_sessions(&self, chat_id: &str) -> Result<Vec<OwnedNativeSession>, SeamError>;

    fn set_native_session_file_path(&self, native_ref: &str, path: &str) -> Result<(), SeamError>;

    fn chats_get(&self, id: &str) -> Result<Option<Chat>, SeamError>;

    fn chats_create(&self, new_chat: &NewChat) -> Result<Chat, SeamError>;

    fn chats_delete(&self, chat_id: &str) -> Result<(), SeamError>;

    fn chats_update(&self, chat_id: &str, patch: &ChatPatch) -> Result<(), SeamError>;

    fn chats_list(&self, project_id: &str) -> Result<Vec<Chat>, SeamError>;

    fn chats_list_all(&self) -> Result<Vec<Chat>, SeamError>;

    fn chats_list_filtered(
        &self,
        project_id: Option<&str>,
        tags_all: Option<&[String]>,
        has_worktree: bool,
        include_archived: bool,
        include_temporary: bool,
    ) -> Result<Vec<Chat>, SeamError>;

    fn chats_reset_working_to_idle(&self) -> Result<i64, SeamError>;

    fn chats_add_mention(&self, chat_id: &str, mention: &SessionMention) -> Result<(), SeamError>;

    fn add_plan_file(&self, chat_id: &str, file_path: &str) -> Result<bool, SeamError>;

    fn add_skill_file(&self, chat_id: &str, entry: &SkillFileEntry) -> Result<bool, SeamError>;

    fn update_todos(&self, chat_id: &str, todos: &[TodoItem]) -> Result<(), SeamError>;

    fn add_detected_prs(
        &self,
        chat_id: &str,
        prs: &[DetectedPr],
    ) -> Result<Vec<DetectedPr>, SeamError>;

    fn get_dismissed_worktrees(&self, _chat_id: &str) -> Result<Vec<String>, SeamError>;

    fn add_dismissed_worktree(
        &self,
        _chat_id: &str,
        _worktree_path: &str,
    ) -> Result<bool, SeamError>;

    fn chats_clear_session(&self, chat_id: &str) -> Result<(), SeamError>;

    fn chats_clear_worktree(&self, chat_id: &str) -> Result<(), SeamError>;

    fn mark_context_lost(&self, chat_id: &str, context_lost_at: &str) -> Result<(), SeamError>;

    fn create_fork(&self, insert: &ForkCreateInput) -> Result<Chat, SeamError>;

    fn get_pending_fork(&self, chat_id: &str) -> Result<Option<PendingForkState>, SeamError>;

    fn clear_pending_fork(&self, chat_id: &str) -> Result<(), SeamError>;

    fn chats_find_or_create_side_chat(&self, parent: &Chat) -> Result<(Chat, bool), SeamError>;

    fn get_imported_session_ids(&self, project_id: &str) -> Result<Vec<String>, SeamError>;

    fn find_by_external_session_id(
        &self,
        session_id: &str,
        project_id: &str,
    ) -> Result<Option<Chat>, SeamError>;

    fn segment_store(&self) -> Option<&dyn crate::segments::SegmentStore>;
}
