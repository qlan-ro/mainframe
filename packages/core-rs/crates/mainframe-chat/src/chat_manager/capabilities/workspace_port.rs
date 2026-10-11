use super::*;

pub trait WorkspacePort: Send + Sync {
    fn remove_scratch_dir<'a>(
        &'a self,
        scratch_path: &'a str,
    ) -> BoxFuture<'a, Result<(), SeamError>>;

    fn write_workspace_trust<'a>(
        &'a self,
        project_path: &'a str,
    ) -> BoxFuture<'a, Result<(), SeamError>>;

    fn attachment_delete_chat<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()>;

    fn process_attachments<'a>(
        &'a self,
        chat_id: &'a str,
        attachment_ids: &'a [String],
    ) -> BoxFuture<'a, ProcessedAttachments>;

    fn kill_tasks_for_chat<'a>(
        &'a self,
        chat_id: &'a str,
        worktree_path: Option<String>,
        session: Option<Arc<dyn AdapterSession>>,
    ) -> BoxFuture<'a, ()>;

    fn remove_worktree<'a>(
        &'a self,
        project_path: &'a str,
        worktree_path: &'a str,
        branch_name: &'a str,
    ) -> BoxFuture<'a, ()>;

    fn stop_launch_processes<'a>(
        &'a self,
        project_id: &'a str,
        effective_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>>;

    fn stop_scope_tunnels<'a>(
        &'a self,
        project_id: &'a str,
        effective_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>>;

    fn get_session_context<'a>(
        &'a self,
        chat_id: &'a str,
        project_path: &'a str,
        session: Option<Arc<dyn AdapterSession>>,
        adapter_id: Option<String>,
    ) -> BoxFuture<'a, SessionContext>;

    fn is_working_tree_dirty<'a>(&'a self, project_path: &'a str) -> BoxFuture<'a, bool>;

    fn extract_mentions_from_text(&self, chat_id: &str, text: &str) -> bool;

    /// `git worktree list` for the project. Defaults to the real git call; a
    /// fake overrides it.
    fn list_worktrees<'a>(
        &'a self,
        project_path: &'a str,
    ) -> BoxFuture<'a, Vec<mainframe_services::workspace::WorktreeEntry>> {
        Box::pin(async move { mainframe_services::workspace::get_worktrees(project_path).await })
    }
}
