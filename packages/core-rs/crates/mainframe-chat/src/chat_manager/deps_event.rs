//! `EventHandlerDeps` adapter and its sub-manager construction.
use super::*;

// ── sub-manager Deps wrappers ────────────────────────────────────────────────

pub(super) struct EhDeps {
    deps: Arc<dyn ChatManagerDeps>,
    active_chats: Registry,
    permissions: Arc<Mutex<PermissionManager>>,
    queued_refs: QueuedRefs,
    worktree_offers: Arc<WorktreeOfferRegistry>,
}

impl EventHandlerDeps for EhDeps {
    fn get_active_chat(&self, chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        self.active_chats.get(chat_id).map(|e| e.value().clone())
    }
    fn emit_event(&self, event: DaemonEvent) {
        enrich_and_emit(self.deps.as_ref(), &self.permissions, event);
    }
    fn get_tool_categories(&self, chat_id: &str) -> Option<ToolCategories> {
        self.deps.get_tool_categories(chat_id)
    }
    fn on_queued_processed(&self, chat_id: &str, uuid: &str) {
        handle_queued_processed(&self.queued_refs, chat_id, uuid);
    }
    fn on_queued_cleared(&self, chat_id: &str) {
        clear_all_queued_for_chat(&self.queued_refs, chat_id);
    }
    fn get_queued_refs(&self, chat_id: &str) -> Vec<QueuedMessageRef> {
        queued_for_chat(&self.queued_refs, chat_id)
    }
    fn prepare_messages_for_client(
        &self,
        raw: &[ChatMessage],
        categories: Option<&ToolCategories>,
    ) -> Vec<DisplayMessage> {
        self.deps.prepare_messages_for_client(raw, categories)
    }
    fn strip_command_tags(&self, text: &str) -> String {
        self.deps.strip_command_tags(text)
    }
    fn chats_update(&self, chat_id: &str, patch: &EventChatUpdate) {
        self.deps.chats_update(chat_id, &ChatUpdate::from(patch));
    }
    fn projects_get_path(&self, project_id: &str) -> Option<String> {
        self.deps.projects_get_path(project_id)
    }
    fn add_plan_file(&self, chat_id: &str, file_path: &str) -> bool {
        self.deps.add_plan_file(chat_id, file_path)
    }
    fn add_skill_file(&self, chat_id: &str, entry: &SkillFileEntry) -> bool {
        self.deps.add_skill_file(chat_id, entry)
    }
    fn update_todos(&self, chat_id: &str, todos: &[TodoItem]) {
        self.deps.update_todos(chat_id, todos);
    }
    fn add_detected_prs(&self, chat_id: &str, prs: &[DetectedPr]) -> Vec<DetectedPr> {
        self.deps.add_detected_prs(chat_id, prs)
    }
    fn should_notify_permission(&self, tool_name: Option<&str>) -> bool {
        self.deps.should_notify_permission(tool_name)
    }
    fn notify_task_complete(&self) -> bool {
        self.deps.notify_task_complete()
    }
    fn notify_session_error(&self) -> bool {
        self.deps.notify_session_error()
    }
    fn notify_attention_request(&self) -> bool {
        self.deps.notify_attention_request()
    }
    fn send_push(&self, msg: PushOut) {
        self.deps.send_push(msg);
    }
    fn on_provider_quota(&self, adapter_id: &str, quota: ProviderQuota) {
        self.deps.on_provider_quota(adapter_id, quota);
    }
    fn on_worktree_trigger(&self, chat_id: &str) {
        self.worktree_offers.on_trigger(chat_id);
    }
    fn tracker_end_all_running(&self, chat_id: &str) {
        self.deps.tracker_end_all_running(chat_id);
    }
    fn workflow_runs_stop_all(&self, chat_id: &str) {
        self.deps.workflow_runs_stop_all(chat_id);
    }
}

pub(super) fn build(
    deps: &Arc<dyn ChatManagerDeps>,
    active_chats: &Registry,
    messages: &Arc<Mutex<MessageCache>>,
    permissions: &Arc<Mutex<PermissionManager>>,
    queued_refs: &QueuedRefs,
    worktree_offers: &Arc<WorktreeOfferRegistry>,
) -> Arc<EventHandler<EhDeps>> {
    let eh_deps = Arc::new(EhDeps {
        deps: deps.clone(),
        active_chats: active_chats.clone(),
        permissions: permissions.clone(),
        queued_refs: queued_refs.clone(),
        worktree_offers: worktree_offers.clone(),
    });
    Arc::new(EventHandler::new(
        messages.clone(),
        permissions.clone(),
        eh_deps,
    ))
}
