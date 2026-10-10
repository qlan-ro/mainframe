//! `ConfigManagerDeps` adapter and its sub-manager construction.
use super::*;
use crate::config_transcripts::OwnedNativeSession;

pub(super) struct CmDeps {
    deps: Arc<dyn ChatManagerDeps>,
    active_chats: Registry,
    enricher: Enricher,
    lifecycle: Arc<ChatLifecycleManager<LcDeps>>,
    worktree_offers: Arc<WorktreeOfferRegistry>,
}

impl ConfigManagerDeps for CmDeps {
    /// Config edits take no lifecycle claim (see `config_api.rs`'s `load_chat`
    /// rebuild), so this read doubles as a use: it touches the cell's clock,
    /// protecting it from the idle scanner for the rest of the edit even though
    /// no claim is held across the `.await`s that follow.
    fn get_active_chat(&self, chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        let cell = self.active_chats.get(chat_id).map(|e| e.value().clone())?;
        self.lifecycle.touch(chat_id);
        Some(cell)
    }
    fn chats_update(&self, chat_id: &str, updates: &ChatPatch) {
        self.deps.chats_update(chat_id, updates);
    }

    fn projects_get(&self, project_id: &str) -> Option<Project> {
        // The config manager only ever reads `project.path`; the facade dep exposes
        // exactly that, so a minimal `Project` (path only) is behaviourally faithful.
        self.deps.projects_get_path(project_id).map(|path| Project {
            id: project_id.to_string(),
            name: String::new(),
            path,
            created_at: String::new(),
            last_opened_at: String::new(),
            parent_project_id: None,
            available: None,
        })
    }
    fn settings_get(&self, ns: &str, key: &str) -> Option<String> {
        self.deps.settings_get(ns, key)
    }
    fn emit_event(&self, event: DaemonEvent) {
        self.enricher.emit(event);
    }
    fn start_chat<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async move { self.lifecycle.start_chat(chat_id).await })
    }
    fn stop_chat<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async move { self.lifecycle.stop_chat(chat_id).await })
    }
    fn apply_tuning<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async move { apply_tuning_impl(&self.active_chats, &self.deps, chat_id).await })
    }
    fn stop_launch_processes<'a>(
        &'a self,
        project_id: &'a str,
        project_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>> {
        self.deps.stop_launch_processes(project_id, project_path)
    }
    fn take_starting_chat<'a>(&'a self, chat_id: &'a str) -> Option<BoxFuture<'a, ()>> {
        // `await_starting` waits out an in-flight spawn and no-ops when none is
        // running, so returning it unconditionally is safe for the miss case.
        Some(Box::pin(async move {
            self.lifecycle.await_starting(chat_id).await;
        }))
    }
    fn on_binding_changed(&self, chat_id: &str, worktree_path: Option<&str>) {
        self.worktree_offers
            .on_binding_changed(chat_id, worktree_path);
    }
    fn live_background_tasks(&self, chat_id: &str) -> usize {
        self.deps.tracker_list_live(chat_id).len()
    }
    fn adapter_name(&self, adapter_id: &str) -> String {
        self.deps.adapter_fork_info(adapter_id).name
    }
    fn has_native_session(&self, chat_id: &str) -> bool {
        self.deps
            .segment_store()
            .is_some_and(|store| store.has_native_id(chat_id))
    }
    fn owned_native_sessions(&self, chat_id: &str) -> Vec<OwnedNativeSession> {
        let Some(layout) = self.deps.segment_store().and_then(|s| s.layout(chat_id)) else {
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
        if let Some(store) = self.deps.segment_store() {
            store.set_session_file_path(native_ref, path);
        }
    }
}

pub(super) fn build(
    deps: &Arc<dyn ChatManagerDeps>,
    active_chats: &Registry,
    enricher: &Enricher,
    lifecycle: &Arc<ChatLifecycleManager<LcDeps>>,
    worktree_offers: &Arc<WorktreeOfferRegistry>,
) -> ChatConfigManager<CmDeps> {
    ChatConfigManager::new(CmDeps {
        deps: deps.clone(),
        active_chats: active_chats.clone(),
        enricher: enricher.clone(),
        lifecycle: lifecycle.clone(),
        worktree_offers: worktree_offers.clone(),
    })
}
