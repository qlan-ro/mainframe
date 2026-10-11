use crate::chat_manager::{ChatStore, ForkCreateInput};
use crate::fork::PendingForkState;
use mainframe_db::{DatabaseManager, actor::SqliteActor};
use mainframe_types::{
    adapter::DetectedPr,
    chat::{Chat, NewChat, TodoItem},
    chat_patch::ChatPatch,
    context::{SessionMention, SkillFileEntry},
    seam_error::SeamError,
};
type Db = SqliteActor<DatabaseManager>;

fn store_error(err: mainframe_db::DbError) -> SeamError {
    tracing::error!(%err, "chat storage operation failed");
    SeamError::new(err)
}

impl ChatStore for Db {
    fn segment_store(&self) -> Option<&dyn crate::segments::SegmentStore> {
        None
    }
    fn chats_get(&self, id: &str) -> Result<Option<Chat>, SeamError> {
        let id = id.to_string();
        self.call_blocking(move |d| d.chats.get(&id))
            .map_err(store_error)
    }
    fn chats_create(&self, new_chat: &NewChat) -> Result<Chat, SeamError> {
        let new_chat = new_chat.clone();
        self.call_blocking(move |d| d.chats.create(&new_chat))
            .map_err(store_error)
    }
    fn chats_delete(&self, chat_id: &str) -> Result<(), SeamError> {
        let chat_id = chat_id.to_string();
        self.call_blocking(move |d| d.chats.delete(&chat_id))
            .map_err(store_error)
    }
    fn chats_update(&self, chat_id: &str, patch: &ChatPatch) -> Result<(), SeamError> {
        let chat_id = chat_id.to_string();
        let patch = patch.clone();
        self.call_blocking(move |d| d.chats.update(&chat_id, &patch))
            .map_err(store_error)
    }
    fn chats_list(&self, project_id: &str) -> Result<Vec<Chat>, SeamError> {
        let project_id = project_id.to_string();
        self.call_blocking(move |d| d.chats.list(&project_id))
            .map_err(store_error)
    }
    fn chats_list_all(&self) -> Result<Vec<Chat>, SeamError> {
        self.call_blocking(move |d| d.chats.list_all())
            .map_err(store_error)
    }
    fn chats_list_filtered(
        &self,
        project_id: Option<&str>,
        tags_all: Option<&[String]>,
        has_worktree: bool,
        include_archived: bool,
        include_temporary: bool,
    ) -> Result<Vec<Chat>, SeamError> {
        let filters = mainframe_db::chats::ChatListFilters {
            project_id: project_id.map(str::to_string),
            tags_all: tags_all.map(<[String]>::to_vec),
            has_worktree,
            include_archived,
            include_temporary,
        };
        self.call_blocking(move |d| d.chats.list_filtered(&filters))
            .map_err(store_error)
    }
    fn chats_reset_working_to_idle(&self) -> Result<i64, SeamError> {
        self.call_blocking(move |d| d.chats.reset_working_to_idle())
            .map_err(store_error)
    }
    fn chats_add_mention(&self, chat_id: &str, mention: &SessionMention) -> Result<(), SeamError> {
        let chat_id = chat_id.to_string();
        let mention = mention.clone();
        self.call_blocking(move |d| d.chats.add_mention(&chat_id, &mention))
            .map_err(store_error)
            .map(|_| ())
    }
    fn add_plan_file(&self, chat_id: &str, file_path: &str) -> Result<bool, SeamError> {
        let chat_id = chat_id.to_string();
        let file_path = file_path.to_string();
        self.call_blocking(move |d| d.chats.add_plan_file(&chat_id, &file_path))
            .map_err(store_error)
    }
    fn add_skill_file(&self, chat_id: &str, entry: &SkillFileEntry) -> Result<bool, SeamError> {
        let chat_id = chat_id.to_string();
        let entry = entry.clone();
        self.call_blocking(move |d| d.chats.add_skill_file(&chat_id, &entry))
            .map_err(store_error)
    }
    fn update_todos(&self, chat_id: &str, todos: &[TodoItem]) -> Result<(), SeamError> {
        let chat_id = chat_id.to_string();
        let todos = todos.to_vec();
        self.call_blocking(move |d| d.chats.update_todos(&chat_id, &todos))
            .map_err(store_error)
    }
    fn add_detected_prs(
        &self,
        chat_id: &str,
        prs: &[DetectedPr],
    ) -> Result<Vec<DetectedPr>, SeamError> {
        let chat_id = chat_id.to_string();
        let prs = prs.to_vec();
        self.call_blocking(move |d| d.chats.add_detected_prs(&chat_id, &prs))
            .map_err(store_error)
    }
    fn get_dismissed_worktrees(&self, chat_id: &str) -> Result<Vec<String>, SeamError> {
        let chat_id = chat_id.to_string();
        self.call_blocking(move |d| d.chats.get_dismissed_worktrees(&chat_id))
            .map_err(store_error)
    }
    fn add_dismissed_worktree(
        &self,
        chat_id: &str,
        worktree_path: &str,
    ) -> Result<bool, SeamError> {
        let chat_id = chat_id.to_string();
        let worktree_path = worktree_path.to_string();
        self.call_blocking(move |d| d.chats.add_dismissed_worktree(&chat_id, &worktree_path))
            .map_err(store_error)
    }
    fn chats_clear_session(&self, chat_id: &str) -> Result<(), SeamError> {
        let chat_id = chat_id.to_string();
        self.call_blocking(move |d| d.chats.clear_session(&chat_id))
            .map_err(store_error)
    }
    fn chats_clear_worktree(&self, chat_id: &str) -> Result<(), SeamError> {
        let chat_id = chat_id.to_string();
        self.call_blocking(move |d| d.chats.clear_worktree(&chat_id))
            .map_err(store_error)
    }
    fn mark_context_lost(&self, chat_id: &str, context_lost_at: &str) -> Result<(), SeamError> {
        let chat_id = chat_id.to_string();
        let context_lost_at = context_lost_at.to_string();
        self.call_blocking(move |d| d.chats.mark_context_lost(&chat_id, &context_lost_at))
            .map_err(store_error)
    }
    fn create_fork(&self, insert: &ForkCreateInput) -> Result<Chat, SeamError> {
        let insert = insert.clone();
        self.call_blocking(move |d| d.chats.create_fork(&insert.as_insert()))
            .map_err(store_error)
    }
    fn get_pending_fork(&self, chat_id: &str) -> Result<Option<PendingForkState>, SeamError> {
        let chat_id = chat_id.to_string();
        self.call_blocking(move |d| d.chats.get_pending_fork(&chat_id))
            .map_err(store_error)
    }
    fn clear_pending_fork(&self, chat_id: &str) -> Result<(), SeamError> {
        let chat_id = chat_id.to_string();
        self.call_blocking(move |d| d.chats.clear_pending_fork(&chat_id))
            .map_err(store_error)
    }
    fn chats_find_or_create_side_chat(&self, parent: &Chat) -> Result<(Chat, bool), SeamError> {
        let parent = parent.clone();
        self.call_blocking(move |d| d.chats.find_or_create_side_chat(&parent))
            .map_err(store_error)
    }
    fn owned_native_sessions(
        &self,
        chat_id: &str,
    ) -> Result<Vec<crate::config_transcripts::OwnedNativeSession>, SeamError> {
        let id = chat_id.to_string();
        let layout = self
            .call_blocking(move |d| d.segments.layout(&id))
            .map_err(store_error)?;
        Ok(layout
            .natives
            .into_iter()
            .filter(|n| n.borrowed_from_chat_id.is_none())
            .filter_map(|n| {
                Some(crate::config_transcripts::OwnedNativeSession {
                    session_id: n.native_session_id?,
                    native_ref: n.id,
                    adapter_id: n.adapter_id,
                })
            })
            .collect())
    }
    fn set_native_session_file_path(&self, native_ref: &str, path: &str) -> Result<(), SeamError> {
        let (id, path) = (native_ref.to_string(), path.to_string());
        self.call_blocking(move |d| d.segments.set_session_file_path(&id, &path))
            .map_err(store_error)
    }
    fn get_imported_session_ids(&self, project_id: &str) -> Result<Vec<String>, SeamError> {
        let id = project_id.to_string();
        self.call_blocking(move |d| d.chats.get_imported_session_ids(&id))
            .map_err(store_error)
    }
    fn find_by_external_session_id(
        &self,
        session_id: &str,
        project_id: &str,
    ) -> Result<Option<Chat>, SeamError> {
        let (sid, pid) = (session_id.to_string(), project_id.to_string());
        self.call_blocking(move |d| d.chats.find_by_external_session_id(&sid, &pid))
            .map_err(store_error)
    }
}

mod context;

#[cfg(test)]
mod tests;
