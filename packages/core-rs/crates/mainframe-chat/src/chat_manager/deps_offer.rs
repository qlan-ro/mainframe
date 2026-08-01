//! `WorktreeOfferDeps` adapter and its sub-manager construction.
use super::*;

/// Shared-internals wrapper backing the worktree offer registry. Built before the
/// sub-manager wrappers so each of them can hold an `Arc` to the same registry.
pub(super) struct OfferDeps {
    deps: Arc<dyn ChatManagerDeps>,
    active_chats: Registry,
    permissions: Arc<Mutex<PermissionManager>>,
}

impl WorktreeOfferDeps for OfferDeps {
    fn emit_event(&self, event: DaemonEvent) {
        enrich_and_emit(self.deps.as_ref(), &self.permissions, event);
    }
    fn projects_get_path(&self, project_id: &str) -> Option<String> {
        self.deps.projects_get_path(project_id)
    }
    fn chat_binding(&self, chat_id: &str) -> Option<(String, Option<String>)> {
        let chat = self
            .active_chats
            .get(chat_id)
            .map(|c| {
                c.value()
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .chat
                    .clone()
            })
            .or_else(|| self.deps.chats_get(chat_id))?;
        Some((chat.project_id, chat.worktree_path))
    }
    fn other_chat_worktrees(&self, project_id: &str, chat_id: &str) -> HashSet<String> {
        self.deps
            .chats_list(project_id)
            .into_iter()
            .filter(|chat| chat.id != chat_id)
            .filter_map(|chat| chat.worktree_path)
            .collect()
    }
    fn get_dismissed_worktrees(&self, chat_id: &str) -> Vec<String> {
        self.deps.get_dismissed_worktrees(chat_id)
    }
    fn add_dismissed_worktree(&self, chat_id: &str, worktree_path: &str) -> bool {
        self.deps.add_dismissed_worktree(chat_id, worktree_path)
    }
}

pub(super) fn build(
    deps: &Arc<dyn ChatManagerDeps>,
    active_chats: &Registry,
    permissions: &Arc<Mutex<PermissionManager>>,
) -> Arc<WorktreeOfferRegistry> {
    Arc::new(WorktreeOfferRegistry::new(Arc::new(OfferDeps {
        deps: deps.clone(),
        active_chats: active_chats.clone(),
        permissions: permissions.clone(),
    })))
}
