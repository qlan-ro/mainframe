//! `LifecycleManagerDeps` adapter and its sub-manager construction.
use super::*;

pub(super) struct LcDeps {
    deps: Arc<dyn ChatManagerDeps>,
    enricher: Enricher,
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
    fn chats_create(&self, new_chat: &NewChat) -> Chat {
        self.deps.chats_create(new_chat)
    }
    fn chats_update(&self, chat_id: &str, patch: &ChatPatch) {
        self.deps.chats_update(chat_id, patch);
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
        self.enricher.emit(event);
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

    fn is_working_tree_dirty<'a>(&'a self, project_path: &'a str) -> BoxFuture<'a, bool> {
        self.deps.is_working_tree_dirty(project_path)
    }
    fn path_exists(&self, path: &str) -> bool {
        self.deps.path_exists(path)
    }
    fn adapter_supports_no_persistence(&self, adapter_id: &str) -> bool {
        self.deps.adapter_supports_no_persistence(adapter_id)
    }
    fn ensure_dir<'a>(&'a self, path: &'a str) -> BoxFuture<'a, ()> {
        self.deps.ensure_dir(path)
    }
    fn mark_context_lost(&self, chat_id: &str, context_lost_at: &str) {
        self.deps.mark_context_lost(chat_id, context_lost_at);
    }
    fn get_pending_fork(&self, chat_id: &str) -> Option<PendingForkState> {
        self.deps.get_pending_fork(chat_id)
    }
    fn compose_history<'a>(
        &'a self,
        chat_id: &'a str,
    ) -> BoxFuture<'a, Option<(Vec<ChatMessage>, usize)>> {
        Box::pin(async move {
            let composed = compose_if_multi(self.deps.as_ref(), chat_id).await?;
            Some((composed.messages, composed.active_from))
        })
    }
}

/// Composes a multi-segment chat's history; `None` for a single-segment chat
/// (or a deps impl without segments), whose one session loads as before.
pub(super) async fn compose_if_multi(
    deps: &dyn ChatManagerDeps,
    chat_id: &str,
) -> Option<crate::segments::compose::Composed> {
    let store = deps.segment_store()?;
    let layout = store
        .layout(chat_id)
        .filter(mainframe_types::segment::SegmentLayout::is_multi_segment)?;
    let chat = deps.chats_get(chat_id)?;
    Some(crate::segments::compose::compose(deps, &chat, &layout).await)
}

pub(super) fn build(
    deps: &Arc<dyn ChatManagerDeps>,
    active_chats: &Registry,
    messages: &Arc<Mutex<MessageCache>>,
    enricher: &Enricher,
    event_handler: &Arc<EventHandler<EhDeps>>,
    worktree_offers: &Arc<WorktreeOfferRegistry>,
) -> Arc<ChatLifecycleManager<LcDeps>> {
    let lc_deps = Arc::new(LcDeps {
        deps: deps.clone(),
        enricher: enricher.clone(),
        event_handler: event_handler.clone(),
        worktree_offers: worktree_offers.clone(),
    });
    Arc::new(
        ChatLifecycleManager::new(
            lc_deps,
            active_chats.clone(),
            messages.clone(),
            enricher.permissions().clone(),
        )
        .with_orchestration(enricher.orchestration().clone()),
    )
}
