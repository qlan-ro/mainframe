//! `LifecycleManagerDeps` adapter and its sub-manager construction.
use super::*;

pub(super) struct LcDeps {
    deps: Arc<dyn ChatManagerDeps>,
    permissions: Arc<Mutex<PermissionManager>>,
    event_handler: Arc<EventHandler<EhDeps>>,
    worktree_offers: Arc<WorktreeOfferRegistry>,
}

impl LifecycleManagerDeps for LcDeps {
    fn chats_get(&self, id: &str) -> Option<Chat> {
        self.deps.chats_get(id)
    }
    fn seed_worktree_baseline<'a>(
        &'a self,
        chat_id: &'a str,
        project_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>> {
        Some(Box::pin(async move {
            self.worktree_offers
                .seed_baseline(chat_id, project_path)
                .await;
        }))
    }
    fn chats_create(
        &self,
        project_id: &str,
        adapter_id: &str,
        model: Option<&str>,
        permission_mode: Option<&str>,
        automation_run_id: Option<&str>,
    ) -> Chat {
        self.deps.chats_create(
            project_id,
            adapter_id,
            model,
            permission_mode,
            automation_run_id,
        )
    }
    fn chats_update(&self, chat_id: &str, patch: &LifecycleChatUpdate) {
        self.deps.chats_update(chat_id, &ChatUpdate::from(patch));
    }
    fn chats_list(&self, project_id: &str) -> Vec<Chat> {
        self.deps.chats_list(project_id)
    }
    fn projects_get_path(&self, project_id: &str) -> Option<String> {
        self.deps.projects_get_path(project_id)
    }
    fn settings_get(&self, ns: &str, key: &str) -> Option<String> {
        self.deps.settings_get(ns, key)
    }
    fn create_session(
        &self,
        adapter_id: &str,
        options: mainframe_types::adapter::SessionOptions,
    ) -> Option<Arc<dyn AdapterSession>> {
        self.deps.create_session(adapter_id, options)
    }
    fn build_sink(&self, chat_id: &str, session_id: &str) -> Arc<dyn SessionSink> {
        self.event_handler
            .build_sink(chat_id, Some(session_id.to_string()))
    }
    fn emit_event(&self, event: DaemonEvent) {
        enrich_and_emit(self.deps.as_ref(), &self.permissions, event);
    }
    fn attachment_delete_chat<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()> {
        self.deps.attachment_delete_chat(chat_id)
    }
    fn kill_tasks_for_chat<'a>(
        &'a self,
        chat_id: &'a str,
        worktree_path: Option<String>,
        session: Option<Arc<dyn AdapterSession>>,
    ) -> BoxFuture<'a, ()> {
        self.deps
            .kill_tasks_for_chat(chat_id, worktree_path, session)
    }
    fn remove_worktree<'a>(
        &'a self,
        project_path: &'a str,
        worktree_path: &'a str,
        branch_name: &'a str,
    ) -> BoxFuture<'a, ()> {
        self.deps
            .remove_worktree(project_path, worktree_path, branch_name)
    }
    fn stop_launch_processes<'a>(
        &'a self,
        project_id: &'a str,
        effective_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>> {
        self.deps.stop_launch_processes(project_id, effective_path)
    }
    fn stop_scope_tunnels<'a>(
        &'a self,
        project_id: &'a str,
        effective_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>> {
        self.deps.stop_scope_tunnels(project_id, effective_path)
    }
    fn scan_loaded_history<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()> {
        self.deps.scan_loaded_history(chat_id)
    }
    fn resolve_tuning<'a>(
        &'a self,
        chat_id: &'a str,
    ) -> BoxFuture<'a, Option<mainframe_types::chat::ResolvedTuning>> {
        self.deps.resolve_tuning(chat_id)
    }
    fn apply_codex_provider_tuning(&self, session: &Arc<dyn AdapterSession>) {
        self.deps.apply_codex_provider_tuning(session);
    }
    fn generate_title<'a>(
        &'a self,
        adapter_id: &'a str,
        content: &'a str,
        binary: &'a str,
    ) -> BoxFuture<'a, Option<String>> {
        self.deps.generate_title(adapter_id, content, binary)
    }
    fn adapter_snapshot_models(
        &self,
        adapter_id: &str,
    ) -> Vec<mainframe_types::adapter::AdapterModel> {
        self.deps.adapter_snapshot_models(adapter_id)
    }
    fn is_working_tree_dirty<'a>(&'a self, project_path: &'a str) -> BoxFuture<'a, bool> {
        self.deps.is_working_tree_dirty(project_path)
    }
    fn path_exists(&self, path: &str) -> bool {
        self.deps.path_exists(path)
    }
}

pub(super) fn build(
    deps: &Arc<dyn ChatManagerDeps>,
    active_chats: &Registry,
    messages: &Arc<Mutex<MessageCache>>,
    permissions: &Arc<Mutex<PermissionManager>>,
    event_handler: &Arc<EventHandler<EhDeps>>,
    worktree_offers: &Arc<WorktreeOfferRegistry>,
) -> Arc<ChatLifecycleManager<LcDeps>> {
    let lc_deps = Arc::new(LcDeps {
        deps: deps.clone(),
        permissions: permissions.clone(),
        event_handler: event_handler.clone(),
        worktree_offers: worktree_offers.clone(),
    });
    Arc::new(ChatLifecycleManager::new(
        lc_deps,
        active_chats.clone(),
        messages.clone(),
        permissions.clone(),
    ))
}
