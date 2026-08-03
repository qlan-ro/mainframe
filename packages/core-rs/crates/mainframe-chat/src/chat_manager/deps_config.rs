//! `ConfigManagerDeps` adapter and its sub-manager construction.
use super::*;

pub(super) struct CmDeps {
    deps: Arc<dyn ChatManagerDeps>,
    active_chats: Registry,
    permissions: Arc<Mutex<PermissionManager>>,
    lifecycle: Arc<ChatLifecycleManager<LcDeps>>,
    worktree_offers: Arc<WorktreeOfferRegistry>,
}

impl ConfigManagerDeps for CmDeps {
    fn get_active_chat(&self, chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        self.active_chats.get(chat_id).map(|e| e.value().clone())
    }
    fn chats_update(&self, chat_id: &str, updates: &ChatFieldUpdate) {
        self.deps.chats_update(
            chat_id,
            &ChatUpdate {
                adapter_id: updates.adapter_id.clone(),
                model: updates.model.clone(),
                permission_mode: updates.permission_mode,
                plan_mode: updates.plan_mode,
                worktree_path: updates.worktree_path.clone(),
                branch_name: updates.branch_name.clone(),
                session_file_path: updates.session_file_path.clone(),
                ..Default::default()
            },
        );
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
        enrich_and_emit(self.deps.as_ref(), &self.permissions, event);
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
        // running, so returning it unconditionally mirrors the TS `startingChats.get`
        // guard (a `resolve()`-then-await for the miss case).
        Some(Box::pin(async move {
            self.lifecycle.await_starting(chat_id).await;
        }))
    }
    fn on_binding_changed(&self, chat_id: &str, worktree_path: Option<&str>) {
        self.worktree_offers
            .on_binding_changed(chat_id, worktree_path);
    }
}

pub(super) fn build(
    deps: &Arc<dyn ChatManagerDeps>,
    active_chats: &Registry,
    permissions: &Arc<Mutex<PermissionManager>>,
    lifecycle: &Arc<ChatLifecycleManager<LcDeps>>,
    worktree_offers: &Arc<WorktreeOfferRegistry>,
) -> ChatConfigManager<CmDeps> {
    ChatConfigManager::new(CmDeps {
        deps: deps.clone(),
        active_chats: active_chats.clone(),
        permissions: permissions.clone(),
        lifecycle: lifecycle.clone(),
        worktree_offers: worktree_offers.clone(),
    })
}
