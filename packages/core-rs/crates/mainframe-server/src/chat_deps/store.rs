use super::*;
use mainframe_chat::config_transcripts::OwnedNativeSession;
use mainframe_chat::{chat_manager::ForkCreateInput, fork::PendingForkState};
use mainframe_types::{
    adapter::DetectedPr,
    chat::TodoItem,
    chat_patch::ChatPatch,
    context::{SessionMention, SkillFileEntry},
};

impl ChatStore for DaemonChatDeps {
    fn idle_markers(&self, chat_id: &str) -> Result<Vec<ChatMessage>, SeamError> {
        let chat_id = chat_id.to_owned();
        self.db
            .call_blocking(move |d| {
                mainframe_db::idle_compaction::markers(d.connection(), &chat_id)
            })
            .map_err(SeamError::new)
    }

    fn idle_commands(
        &self,
        chat_id: &str,
    ) -> Result<Vec<mainframe_types::compaction::NativeCompactionRequest>, SeamError> {
        let chat_id = chat_id.to_owned();
        self.db
            .call_blocking(move |d| {
                mainframe_db::idle_compaction::commands(d.connection(), &chat_id)
            })
            .map_err(SeamError::new)
    }

    fn idle_queue_put(
        &self,
        chat_id: &str,
        input: &mainframe_db::idle_compaction_queue::QueuedInput,
    ) -> Result<(), SeamError> {
        let (chat_id, input) = (chat_id.to_owned(), input.clone());
        self.db
            .call_blocking(move |d| {
                mainframe_db::idle_compaction_queue::put(d.connection(), &chat_id, &input)
            })
            .map_err(SeamError::new)
    }
    fn idle_queue_list(
        &self,
        chat_id: &str,
    ) -> Result<Vec<mainframe_db::idle_compaction_queue::QueuedInput>, SeamError> {
        let chat_id = chat_id.to_owned();
        self.db
            .call_blocking(move |d| {
                mainframe_db::idle_compaction_queue::list(d.connection(), &chat_id)
            })
            .map_err(SeamError::new)
    }
    fn idle_queue_remove(&self, chat_id: &str, uuid: &str) -> Result<bool, SeamError> {
        let (chat_id, uuid) = (chat_id.to_owned(), uuid.to_owned());
        self.db
            .call_blocking(move |d| {
                mainframe_db::idle_compaction_queue::remove(d.connection(), &chat_id, &uuid)
            })
            .map_err(SeamError::new)
    }

    fn idle_run_begin(&self, chat_id: &str, generation: &str) -> Result<(), SeamError> {
        let (chat_id, generation) = (chat_id.to_owned(), generation.to_owned());
        self.db
            .call_blocking(move |d| {
                mainframe_db::idle_compaction::begin(d.connection(), &chat_id, &generation)
            })
            .map_err(SeamError::new)
    }
    fn idle_run_complete(
        &self,
        chat_id: &str,
        generation: &str,
        at: Option<i64>,
    ) -> Result<(), SeamError> {
        let (chat_id, generation) = (chat_id.to_owned(), generation.to_owned());
        self.db
            .call_blocking(move |d| {
                mainframe_db::idle_compaction::complete(d.connection(), &chat_id, &generation, at)
            })
            .map_err(SeamError::new)
    }
    fn idle_run_get(
        &self,
        chat_id: &str,
    ) -> Result<Option<mainframe_db::idle_compaction::RealRun>, SeamError> {
        let chat_id = chat_id.to_owned();
        self.db
            .call_blocking(move |d| mainframe_db::idle_compaction::get(d.connection(), &chat_id))
            .map_err(SeamError::new)
    }
    fn idle_run_claim(
        &self,
        chat_id: &str,
        generation: &str,
        request: &mainframe_types::compaction::NativeCompactionRequest,
    ) -> Result<bool, SeamError> {
        let (chat_id, generation, request) =
            (chat_id.to_owned(), generation.to_owned(), request.clone());
        self.db
            .call_blocking(move |d| {
                mainframe_db::idle_compaction::claim(
                    d.connection(),
                    &chat_id,
                    &generation,
                    &request,
                )
            })
            .map_err(SeamError::new)
    }
    fn idle_record(
        &self,
        chat_id: &str,
        metadata: &mainframe_types::compaction::CompactionMetadata,
    ) -> Result<bool, SeamError> {
        let (chat_id, metadata) = (chat_id.to_owned(), metadata.clone());
        self.db
            .call_blocking(move |d| {
                mainframe_db::idle_compaction::record(d.connection(), &chat_id, &metadata)
            })
            .map_err(SeamError::new)
    }
    fn idle_provenance(
        &self,
        chat_id: &str,
    ) -> Result<Vec<mainframe_types::compaction::CompactionMetadata>, SeamError> {
        let chat_id = chat_id.to_owned();
        self.db
            .call_blocking(move |d| {
                mainframe_db::idle_compaction::provenance(d.connection(), &chat_id)
            })
            .map_err(SeamError::new)
    }

    fn chats_create(&self, new_chat: &NewChat) -> Result<Chat, SeamError> {
        self.db.chats_create(&NewChat {
            scratch_root: Some(self.data_dir.join("scratch").to_string_lossy().into_owned()),
            ..new_chat.clone()
        })
    }
    fn segment_store(&self) -> Option<&dyn mainframe_chat::segments::SegmentStore> {
        Some(self)
    }
    fn owned_native_sessions(&self, chat_id: &str) -> Result<Vec<OwnedNativeSession>, SeamError> {
        self.db.owned_native_sessions(chat_id)
    }
    fn set_native_session_file_path(&self, native_ref: &str, path: &str) -> Result<(), SeamError> {
        self.db.set_native_session_file_path(native_ref, path)
    }
    fn chats_get(&self, id: &str) -> Result<Option<Chat>, SeamError> {
        self.db.chats_get(id)
    }
    fn chats_delete(&self, chat_id: &str) -> Result<(), SeamError> {
        self.db.chats_delete(chat_id)
    }
    fn chats_update(&self, chat_id: &str, patch: &ChatPatch) -> Result<(), SeamError> {
        self.db.chats_update(chat_id, patch)
    }
    fn chats_list(&self, project_id: &str) -> Result<Vec<Chat>, SeamError> {
        self.db.chats_list(project_id)
    }
    fn chats_list_all(&self) -> Result<Vec<Chat>, SeamError> {
        self.db.chats_list_all()
    }
    fn chats_list_filtered(
        &self,
        project_id: Option<&str>,
        tags_all: Option<&[String]>,
        has_worktree: bool,
        include_archived: bool,
        include_temporary: bool,
    ) -> Result<Vec<Chat>, SeamError> {
        self.db.chats_list_filtered(
            project_id,
            tags_all,
            has_worktree,
            include_archived,
            include_temporary,
        )
    }
    fn chats_reset_working_to_idle(&self) -> Result<i64, SeamError> {
        self.db.chats_reset_working_to_idle()
    }
    fn chats_add_mention(&self, chat_id: &str, mention: &SessionMention) -> Result<(), SeamError> {
        self.db.chats_add_mention(chat_id, mention)
    }
    fn add_plan_file(&self, chat_id: &str, file_path: &str) -> Result<bool, SeamError> {
        self.db.add_plan_file(chat_id, file_path)
    }
    fn add_skill_file(&self, chat_id: &str, entry: &SkillFileEntry) -> Result<bool, SeamError> {
        self.db.add_skill_file(chat_id, entry)
    }
    fn update_todos(&self, chat_id: &str, todos: &[TodoItem]) -> Result<(), SeamError> {
        self.db.update_todos(chat_id, todos)
    }
    fn add_detected_prs(
        &self,
        chat_id: &str,
        prs: &[DetectedPr],
    ) -> Result<Vec<DetectedPr>, SeamError> {
        self.db.add_detected_prs(chat_id, prs)
    }
    fn get_dismissed_worktrees(&self, _chat_id: &str) -> Result<Vec<String>, SeamError> {
        self.db.get_dismissed_worktrees(_chat_id)
    }
    fn add_dismissed_worktree(
        &self,
        _chat_id: &str,
        _worktree_path: &str,
    ) -> Result<bool, SeamError> {
        self.db.add_dismissed_worktree(_chat_id, _worktree_path)
    }
    fn chats_clear_session(&self, chat_id: &str) -> Result<(), SeamError> {
        self.db.chats_clear_session(chat_id)
    }
    fn chats_clear_worktree(&self, chat_id: &str) -> Result<(), SeamError> {
        self.db.chats_clear_worktree(chat_id)
    }
    fn mark_context_lost(&self, chat_id: &str, context_lost_at: &str) -> Result<(), SeamError> {
        self.db.mark_context_lost(chat_id, context_lost_at)
    }
    fn create_fork(&self, insert: &ForkCreateInput) -> Result<Chat, SeamError> {
        self.db.create_fork(insert)
    }
    fn get_pending_fork(&self, chat_id: &str) -> Result<Option<PendingForkState>, SeamError> {
        self.db.get_pending_fork(chat_id)
    }
    fn clear_pending_fork(&self, chat_id: &str) -> Result<(), SeamError> {
        self.db.clear_pending_fork(chat_id)
    }
    fn chats_find_or_create_side_chat(&self, parent: &Chat) -> Result<(Chat, bool), SeamError> {
        self.db.chats_find_or_create_side_chat(parent)
    }
    fn get_imported_session_ids(&self, project_id: &str) -> Result<Vec<String>, SeamError> {
        self.db.get_imported_session_ids(project_id)
    }
    fn find_by_external_session_id(
        &self,
        session_id: &str,
        project_id: &str,
    ) -> Result<Option<Chat>, SeamError> {
        self.db.find_by_external_session_id(session_id, project_id)
    }
}

impl DaemonChatDeps {
    pub(super) fn emit_storage_error(&self, chat_id: &str, error: SeamError) {
        tracing::error!(%error, chat_id, "chat storage operation failed");
        self.emit_event(DaemonEvent::Error {
            chat_id: Some(chat_id.into()),
            error: error.to_string(),
        });
    }
}
