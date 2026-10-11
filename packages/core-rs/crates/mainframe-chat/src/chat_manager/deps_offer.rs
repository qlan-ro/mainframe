//! `WorktreeOfferDeps` adapter and its sub-manager construction.
use super::*;
use mainframe_types::sync::LockExt as _;

/// Shared-internals wrapper backing the worktree offer registry. Built before the
/// sub-manager wrappers so each of them can hold an `Arc` to the same registry.
pub(super) struct OfferDeps {
    shared: Arc<ChatShared>,
}

impl WorktreeOfferDeps for OfferDeps {
    fn emit_event(&self, event: DaemonEvent) {
        self.shared.emit(event);
    }
    fn projects_get_path(&self, project_id: &str) -> Option<String> {
        self.shared.deps.projects_get_path(project_id)
    }
    fn chat_binding(&self, chat_id: &str) -> Option<(String, Option<String>)> {
        let chat = self
            .shared
            .active_chats
            .get(chat_id)
            .map(|c| c.value().lock_recover().chat.clone())
            .or_else(|| self.shared.deps.chats_get(chat_id))?;
        Some((chat.project_id, chat.worktree_path))
    }
    fn other_chat_worktrees(&self, project_id: &str, chat_id: &str) -> HashSet<String> {
        self.shared
            .deps
            .chats_list(project_id)
            .into_iter()
            .filter(|chat| chat.id != chat_id)
            .filter_map(|chat| chat.worktree_path)
            .collect()
    }
    fn get_dismissed_worktrees(&self, chat_id: &str) -> Vec<String> {
        self.shared.deps.get_dismissed_worktrees(chat_id)
    }
    fn add_dismissed_worktree(&self, chat_id: &str, worktree_path: &str) -> bool {
        self.shared
            .deps
            .add_dismissed_worktree(chat_id, worktree_path)
    }
}

pub(super) fn build(shared: &Arc<ChatShared>) -> Arc<WorktreeOfferRegistry> {
    Arc::new(WorktreeOfferRegistry::new(Arc::new(OfferDeps {
        shared: shared.clone(),
    })))
}
