//! `EventHandlerDeps` adapter and its sub-manager construction.
use super::*;
use mainframe_types::sync::LockExt as _;

// ── sub-manager Deps wrappers ────────────────────────────────────────────────

pub(super) struct EhDeps {
    shared: Arc<ChatShared>,
    worktree_offers: Arc<WorktreeOfferRegistry>,
}

impl EventHandlerDeps for EhDeps {
    fn get_active_chat(&self, chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        self.shared
            .active_chats
            .get(chat_id)
            .map(|e| e.value().clone())
    }
    fn emit_event(&self, event: DaemonEvent) {
        self.shared.emit(event);
    }
    fn get_tool_categories(&self, chat_id: &str) -> Option<ToolCategories> {
        self.shared.deps.get_tool_categories(chat_id)
    }
    fn on_queued_processed(&self, chat_id: &str, uuid: &str) {
        handle_queued_processed(&self.shared.queued_refs, chat_id, uuid);
    }
    fn on_queued_cleared(&self, chat_id: &str) {
        clear_all_queued_for_chat(&self.shared.queued_refs, chat_id);
    }
    fn get_queued_refs(&self, chat_id: &str) -> Vec<QueuedMessageRef> {
        queued_for_chat(&self.shared.queued_refs, chat_id)
    }
    fn display_projector(&self) -> Box<dyn mainframe_display::DisplayProjector> {
        self.shared.deps.display_projector()
    }
    fn strip_command_tags(&self, text: &str) -> String {
        self.shared.deps.strip_command_tags(text)
    }
    fn chats_update(&self, chat_id: &str, patch: &ChatPatch) {
        self.shared.deps.chats_update(chat_id, patch);
    }
    fn projects_get_path(&self, project_id: &str) -> Option<String> {
        self.shared.deps.projects_get_path(project_id)
    }
    fn initial_transcript_path(
        &self,
        adapter_id: &str,
        session_id: &str,
        cwd: &str,
    ) -> Option<String> {
        self.shared
            .deps
            .initial_transcript_path(adapter_id, session_id, cwd)
    }
    fn add_plan_file(&self, chat_id: &str, file_path: &str) -> bool {
        self.shared.deps.add_plan_file(chat_id, file_path)
    }
    fn add_skill_file(&self, chat_id: &str, entry: &SkillFileEntry) -> bool {
        self.shared.deps.add_skill_file(chat_id, entry)
    }
    fn update_todos(&self, chat_id: &str, todos: &[TodoItem]) {
        self.shared.deps.update_todos(chat_id, todos);
    }
    fn add_detected_prs(&self, chat_id: &str, prs: &[DetectedPr]) -> Vec<DetectedPr> {
        self.shared.deps.add_detected_prs(chat_id, prs)
    }
    fn should_notify_permission(&self, tool_name: Option<&str>) -> bool {
        self.shared.deps.should_notify_permission(tool_name)
    }
    fn notify_task_complete(&self) -> bool {
        self.shared.deps.notify_task_complete()
    }
    fn notify_session_error(&self) -> bool {
        self.shared.deps.notify_session_error()
    }
    fn notify_attention_request(&self) -> bool {
        self.shared.deps.notify_attention_request()
    }
    fn send_push(&self, msg: PushOut) {
        self.shared.deps.send_push(msg);
    }
    fn on_provider_quota(&self, adapter_id: &str, quota: ProviderQuota) {
        self.shared.deps.on_provider_quota(adapter_id, quota);
    }
    fn on_worktree_trigger(&self, chat_id: &str) {
        self.worktree_offers.on_trigger(chat_id);
    }
    fn on_transcript_moved(&self, chat_id: &str) {
        let Some(cell) = self.get_active_chat(chat_id) else {
            return;
        };
        let mut chat = cell.lock_recover().chat.clone();
        let presence = PresenceDeps {
            shared: self.shared.clone(),
        };
        tokio::spawn(async move {
            crate::transcript_presence::refresh_transcript_location(&presence, &mut chat).await;
        });
    }
    fn tracker_end_all_running(&self, chat_id: &str) {
        self.shared.deps.tracker_end_all_running(chat_id);
    }
    fn workflow_runs_stop_all(&self, chat_id: &str) {
        self.shared.deps.workflow_runs_stop_all(chat_id);
    }
    fn get_pending_fork(&self, chat_id: &str) -> Option<PendingForkState> {
        self.shared.deps.get_pending_fork(chat_id)
    }
    fn clear_pending_fork(&self, chat_id: &str) {
        self.shared.deps.clear_pending_fork(chat_id);
    }
    fn segment_store(&self) -> Option<&dyn crate::segments::SegmentStore> {
        self.shared.deps.segment_store()
    }
    fn adapter_name(&self, adapter_id: &str) -> String {
        self.shared.deps.adapter_fork_info(adapter_id).name
    }
}

pub(super) fn build(
    shared: &Arc<ChatShared>,
    worktree_offers: &Arc<WorktreeOfferRegistry>,
) -> Arc<EventHandler<EhDeps>> {
    let eh_deps = Arc::new(EhDeps {
        shared: shared.clone(),
        worktree_offers: worktree_offers.clone(),
    });
    Arc::new(EventHandler::new(
        shared.messages.clone(),
        shared.permissions.clone(),
        eh_deps,
    ))
}
