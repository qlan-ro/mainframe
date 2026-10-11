use super::*;

/// `mainframe_chat::fork::PendingForkState` → the DB repository's `PendingFork`.
/// Field-for-field; the two exist separately only because
/// `mainframe-chat` does not depend on `mainframe-db`.
fn to_db_pending_fork(pending: &PendingForkState) -> mainframe_db::chats::PendingFork {
    mainframe_db::chats::PendingFork {
        fork_source: pending.fork_source.clone(),
        snapshot_dir: pending.snapshot_dir.clone(),
        provisional_title: pending.provisional_title.clone(),
    }
}

/// The DB repository's `PendingFork` → `mainframe_chat::fork::PendingForkState`.
fn from_db_pending_fork(pending: mainframe_db::chats::PendingFork) -> PendingForkState {
    PendingForkState {
        fork_source: pending.fork_source,
        snapshot_dir: pending.snapshot_dir,
        provisional_title: pending.provisional_title,
    }
}

/// `ChatManager::fork_chat`'s `ForkCreateInput` → the DB repository's
/// `ForkInsert<'a>`. A free function rather than a method so it can
/// borrow from `input` and `pending_fork` with independent lifetimes.
fn to_db_fork_insert<'a>(
    input: &'a ForkCreateInput,
    pending_fork: &'a mainframe_db::chats::PendingFork,
) -> mainframe_db::chats::ForkInsert<'a> {
    mainframe_db::chats::ForkInsert {
        parent_chat_id: &input.parent_chat_id,
        project_id: &input.project_id,
        adapter_id: &input.adapter_id,
        model: input.model.as_deref(),
        permission_mode: input.permission_mode,
        plan_mode: input.plan_mode,
        effort: input.effort,
        fast: input.fast,
        ultracode: input.ultracode,
        adaptive_thinking: input.adaptive_thinking,
        worktree_path: input.worktree_path.as_deref(),
        branch_name: input.branch_name.as_deref(),
        title: input.title.as_deref(),
        pending_fork,
        segments: input.segments.as_ref(),
    }
}

impl ChatStore for DaemonChatDeps {
    fn chats_get(&self, id: &str) -> Option<Chat> {
        let id = id.to_string();
        self.db
            .call_blocking(move |d| d.chats.get(&id))
            .ok()
            .flatten()
    }
    fn chats_create(&self, new_chat: &NewChat) -> Chat {
        // The scratch root is a daemon concern (`<data_dir>/scratch`);
        // the caller only ever knows the chat is non-project, never the path.
        let db_new_chat = NewChat {
            scratch_root: Some(self.data_dir.join("scratch").to_string_lossy().into_owned()),
            ..new_chat.clone()
        };
        let created = self.db.call_blocking(move |d| d.chats.create(&db_new_chat));
        match created {
            Ok(chat) => chat,
            // The trait signature is infallible; a DB failure has no error channel
            // to surface through, so log loudly and return an unpersisted stub so
            // the caller does not crash. TODO: revisit if the orchestration ever
            // grows a fallible create path.
            Err(err) => {
                tracing::error!(
                    %err,
                    project_id = new_chat.project_id,
                    adapter_id = new_chat.adapter_id,
                    "chats.create failed"
                );
                // Unpersisted stub for the (near-impossible) create failure.
                Chat::unpersisted(new_chat)
            }
        }
    }
    fn chats_delete(&self, chat_id: &str) {
        let id = chat_id.to_string();
        if let Err(err) = self.db.call_blocking(move |d| d.chats.delete(&id)) {
            tracing::warn!(%err, chat_id, "chats.delete failed");
        }
    }
    fn chats_update(&self, chat_id: &str, patch: &ChatPatch) {
        let id = chat_id.to_string();
        let db_patch = patch.clone();
        if let Err(err) = self
            .db
            .call_blocking(move |d| d.chats.update(&id, &db_patch))
        {
            tracing::warn!(%err, chat_id, "chats.update failed");
        }
    }
    fn chats_clear_session(&self, chat_id: &str) {
        let id = chat_id.to_string();
        if let Err(err) = self.db.call_blocking(move |d| d.chats.clear_session(&id)) {
            tracing::warn!(%err, chat_id, "chats.clearSession failed");
        }
    }
    fn chats_clear_worktree(&self, chat_id: &str) {
        let id = chat_id.to_string();
        if let Err(err) = self.db.call_blocking(move |d| d.chats.clear_worktree(&id)) {
            tracing::warn!(%err, chat_id, "chats.clearWorktree failed");
        }
    }
    fn chats_list(&self, project_id: &str) -> Vec<Chat> {
        let pid = project_id.to_string();
        self.db
            .call_blocking(move |d| d.chats.list(&pid))
            .unwrap_or_default()
    }
    fn chats_list_all(&self) -> Vec<Chat> {
        self.db
            .call_blocking(|d| d.chats.list_all())
            .unwrap_or_default()
    }
    fn chats_list_filtered(
        &self,
        project_id: Option<&str>,
        tags_all: Option<&[String]>,
        has_worktree: bool,
        include_archived: bool,
        include_temporary: bool,
    ) -> Vec<Chat> {
        let filters = mainframe_db::chats::ChatListFilters {
            project_id: project_id.map(str::to_string),
            tags_all: tags_all.map(<[String]>::to_vec),
            has_worktree,
            include_archived,
            include_temporary,
        };
        self.db
            .call_blocking(move |d| d.chats.list_filtered(&filters))
            .unwrap_or_default()
    }
    fn chats_add_mention(&self, chat_id: &str, mention: &SessionMention) {
        let (id, mention) = (chat_id.to_string(), mention.clone());
        if let Err(err) = self
            .db
            .call_blocking(move |d| d.chats.add_mention(&id, &mention))
        {
            tracing::warn!(%err, chat_id, "chats.add_mention failed");
        }
    }
    fn chats_reset_working_to_idle(&self) -> i64 {
        self.db
            .call_blocking(|d| d.chats.reset_working_to_idle())
            .unwrap_or(0)
    }
    fn add_plan_file(&self, chat_id: &str, file_path: &str) -> bool {
        let (id, fp) = (chat_id.to_string(), file_path.to_string());
        self.db
            .call_blocking(move |d| d.chats.add_plan_file(&id, &fp))
            .unwrap_or(false)
    }
    fn add_skill_file(&self, chat_id: &str, entry: &SkillFileEntry) -> bool {
        let (id, entry) = (chat_id.to_string(), entry.clone());
        self.db
            .call_blocking(move |d| d.chats.add_skill_file(&id, &entry))
            .unwrap_or(false)
    }
    fn update_todos(&self, chat_id: &str, todos: &[TodoItem]) {
        let (id, todos) = (chat_id.to_string(), todos.to_vec());
        if let Err(err) = self
            .db
            .call_blocking(move |d| d.chats.update_todos(&id, &todos))
        {
            tracing::warn!(%err, chat_id, "chats.update_todos failed");
        }
    }
    fn add_detected_prs(&self, chat_id: &str, prs: &[DetectedPr]) -> Vec<DetectedPr> {
        let (id, prs) = (chat_id.to_string(), prs.to_vec());
        self.db
            .call_blocking(move |d| d.chats.add_detected_prs(&id, &prs))
            .unwrap_or_default()
    }
    fn get_dismissed_worktrees(&self, chat_id: &str) -> Vec<String> {
        let id = chat_id.to_string();
        self.db
            .call_blocking(move |d| d.chats.get_dismissed_worktrees(&id))
            .unwrap_or_default()
    }
    fn add_dismissed_worktree(&self, chat_id: &str, worktree_path: &str) -> bool {
        let (id, path) = (chat_id.to_string(), worktree_path.to_string());
        self.db
            .call_blocking(move |d| d.chats.add_dismissed_worktree(&id, &path))
            .unwrap_or(false)
    }
    fn mark_context_lost(&self, chat_id: &str, context_lost_at: &str) {
        let id = chat_id.to_string();
        let at = context_lost_at.to_string();
        if let Err(err) = self
            .db
            .call_blocking(move |d| d.chats.mark_context_lost(&id, &at))
        {
            tracing::warn!(%err, chat_id, "chats.markContextLost failed");
        }
    }
    fn create_fork(&self, insert: &ForkCreateInput) -> Result<Chat, SeamError> {
        let input = insert.clone();
        let db_pending = to_db_pending_fork(&input.pending_fork);
        self.db
            .call_blocking(move |d| {
                let fork_insert = to_db_fork_insert(&input, &db_pending);
                d.chats.create_fork(&fork_insert)
            })
            .map_err(SeamError::new)
    }
    fn get_pending_fork(&self, chat_id: &str) -> Option<PendingForkState> {
        let id = chat_id.to_string();
        self.db
            .call_blocking(move |d| d.chats.get_pending_fork(&id))
            .ok()
            .flatten()
            .map(from_db_pending_fork)
    }
    fn clear_pending_fork(&self, chat_id: &str) {
        let id = chat_id.to_string();
        if let Err(err) = self
            .db
            .call_blocking(move |d| d.chats.clear_pending_fork(&id))
        {
            tracing::warn!(%err, chat_id, "chats.clear_pending_fork failed");
        }
    }
    fn chats_find_or_create_side_chat(&self, parent: &Chat) -> Result<(Chat, bool), SeamError> {
        let parent = parent.clone();
        self.db
            .call_blocking(move |d| d.chats.find_or_create_side_chat(&parent))
            .map_err(SeamError::new)
    }
    fn segment_store(&self) -> Option<&dyn mainframe_chat::segments::SegmentStore> {
        Some(self)
    }
}
