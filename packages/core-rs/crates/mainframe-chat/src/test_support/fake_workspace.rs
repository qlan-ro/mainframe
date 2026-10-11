//! The `WorkspacePort` half of [`FakeDeps`]: filesystem, git, attachment and
//! launch seams, each recording its calls.

use mainframe_types::sync::LockExt as _;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use mainframe_adapter_api::{AdapterSession, BoxFuture};
use mainframe_services::workspace::WorktreeEntry;
use mainframe_types::context::SessionContext;
use mainframe_types::seam_error::SeamError;

use super::FakeDeps;
use crate::chat_manager::{ProcessedAttachments, WorkspacePort};

#[derive(Default)]
pub(crate) struct FakeWorkspacePort {
    pub(crate) move_files_error: Mutex<Option<String>>,
    pub(crate) move_fail_session: Mutex<Option<String>>,
    pub(crate) moved_sessions: Arc<Mutex<Vec<String>>>,
    pub(crate) branch_missing: Mutex<bool>,
    pub(crate) added_worktrees: Mutex<Vec<(String, String, String)>>,
    /// Interleaving log shared with recording sessions: `kill:<chat>:<wt>`
    /// entries from `kill_tasks_for_chat` next to the session's own kills.
    pub(crate) order: Arc<Mutex<Vec<String>>>,
    /// Every path `write_workspace_trust` persisted, for assertion.
    pub(crate) trusted_paths: Mutex<Vec<String>>,
    /// When `Some`, `write_workspace_trust` fails with this message instead of
    /// recording the call.
    pub(crate) fail_trust_write: Mutex<Option<String>>,
    /// When set, `process_attachments` returns a clone of it; `None` keeps
    /// `ProcessedAttachments::default()`.
    pub(crate) attachments: Mutex<Option<ProcessedAttachments>>,
    /// What `extract_mentions_from_text` returns.
    pub(crate) mentions_found: Mutex<bool>,
    /// Every `remove_scratch_dir` path, in order.
    pub(crate) remove_scratch_dir_calls: Mutex<Vec<String>>,
    /// When `Some`, `remove_scratch_dir` fails with this message instead of
    /// recording success. Cleared by the test between a failing call and a
    /// retry, so `discard_chat` can be proven retryable.
    pub(crate) fail_remove_scratch_dir: Mutex<Option<String>>,
    /// Every `(project_id, effective_path)` `stop_launch_processes` saw.
    pub(crate) stop_calls: Mutex<Vec<(String, String)>>,
    /// Every `(project_id, effective_path)` `stop_scope_tunnels` saw.
    pub(crate) tunnel_stop_calls: Mutex<Vec<(String, String)>>,
    /// `true` reproduces a scope with a launch manager, where
    /// `stop_launch_processes` yields a future; `false` (the default) a scope
    /// that never ran a launch config, where it yields `None`.
    pub(crate) has_launches: Mutex<bool>,
    /// What `is_working_tree_dirty` answers.
    pub(crate) dirty: Mutex<bool>,
    /// Every `remove_worktree(project_path, worktree_path, branch)` call.
    pub(crate) removed_worktrees: Mutex<Vec<(String, String, String)>>,
    /// What `list_worktrees` answers.
    pub(crate) listing: Mutex<Vec<WorktreeEntry>>,
    /// How often `list_worktrees` ran.
    pub(crate) list_calls: AtomicUsize,
}

impl WorkspacePort for FakeDeps {
    fn move_claude_session_files<'a>(
        &'a self,
        session: &'a str,
        _: &'a str,
        _: &'a str,
    ) -> BoxFuture<'a, Result<(), mainframe_services::workspace::session_files::SessionFilesError>>
    {
        Box::pin(async move {
            if let Some(error) = self.workspace.move_files_error.lock_recover().clone() {
                return Err(std::io::Error::other(error).into());
            }
            if self.workspace.move_fail_session.lock_recover().as_deref() == Some(session) {
                return Err(std::io::Error::other("disk full").into());
            }
            self.workspace
                .moved_sessions
                .lock_recover()
                .push(session.into());
            Ok(())
        })
    }

    fn branch_exists<'a>(&'a self, _: &'a str, _: &'a str) -> BoxFuture<'a, bool> {
        let exists = !*self.workspace.branch_missing.lock_recover();
        Box::pin(async move { exists })
    }
    fn add_worktree<'a>(
        &'a self,
        project: &'a str,
        path: &'a str,
        branch: &'a str,
    ) -> BoxFuture<'a, ()> {
        self.workspace.added_worktrees.lock_recover().push((
            project.into(),
            path.into(),
            branch.into(),
        ));
        Box::pin(async {})
    }

    fn remove_scratch_dir<'a>(
        &'a self,
        scratch_path: &'a str,
    ) -> BoxFuture<'a, Result<(), SeamError>> {
        self.workspace
            .remove_scratch_dir_calls
            .lock_recover()
            .push(scratch_path.to_string());
        let fail = self
            .workspace
            .fail_remove_scratch_dir
            .lock_recover()
            .clone();
        Box::pin(async move {
            match fail {
                Some(msg) => Err(SeamError::msg(msg)),
                None => Ok(()),
            }
        })
    }
    fn write_workspace_trust<'a>(
        &'a self,
        project_path: &'a str,
    ) -> BoxFuture<'a, Result<(), SeamError>> {
        Box::pin(async move {
            if let Some(msg) = self.workspace.fail_trust_write.lock_recover().clone() {
                return Err(SeamError::msg(msg));
            }
            self.workspace
                .trusted_paths
                .lock_recover()
                .push(project_path.to_string());
            Ok(())
        })
    }
    fn attachment_delete_chat<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async {})
    }
    fn process_attachments<'a>(
        &'a self,
        _chat_id: &'a str,
        _attachment_ids: &'a [String],
    ) -> BoxFuture<'a, ProcessedAttachments> {
        let p = self
            .workspace
            .attachments
            .lock_recover()
            .clone()
            .unwrap_or_default();
        Box::pin(async move { p })
    }
    fn kill_tasks_for_chat<'a>(
        &'a self,
        chat_id: &'a str,
        worktree_path: Option<String>,
        _session: Option<Arc<dyn AdapterSession>>,
    ) -> BoxFuture<'a, ()> {
        self.workspace.order.lock_recover().push(format!(
            "kill:{chat_id}:{}",
            worktree_path.as_deref().unwrap_or("no-wt")
        ));
        Box::pin(async {})
    }
    fn remove_worktree<'a>(
        &'a self,
        project_path: &'a str,
        worktree_path: &'a str,
        branch_name: &'a str,
    ) -> BoxFuture<'a, ()> {
        self.workspace.removed_worktrees.lock_recover().push((
            project_path.to_string(),
            worktree_path.to_string(),
            branch_name.to_string(),
        ));
        Box::pin(async {})
    }
    fn stop_launch_processes<'a>(
        &'a self,
        project_id: &'a str,
        effective_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>> {
        if !*self.workspace.has_launches.lock_recover() {
            return None;
        }
        self.workspace
            .stop_calls
            .lock_recover()
            .push((project_id.to_string(), effective_path.to_string()));
        Some(Box::pin(async {}))
    }
    fn stop_scope_tunnels<'a>(
        &'a self,
        project_id: &'a str,
        effective_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>> {
        self.workspace
            .tunnel_stop_calls
            .lock_recover()
            .push((project_id.to_string(), effective_path.to_string()));
        Some(Box::pin(async {}))
    }
    fn get_session_context<'a>(
        &'a self,
        _chat_id: &'a str,
        _project_path: &'a str,
        _session: Option<Arc<dyn AdapterSession>>,
        _adapter_id: Option<String>,
    ) -> BoxFuture<'a, SessionContext> {
        Box::pin(async {
            SessionContext {
                global_files: Vec::new(),
                project_files: Vec::new(),
                mentions: Vec::new(),
                attachments: Vec::new(),
                modified_files: Vec::new(),
                skill_files: Vec::new(),
            }
        })
    }
    fn is_working_tree_dirty<'a>(&'a self, _project_path: &'a str) -> BoxFuture<'a, bool> {
        let dirty = *self.workspace.dirty.lock_recover();
        Box::pin(async move { dirty })
    }
    fn extract_mentions_from_text(&self, _chat_id: &str, _text: &str) -> bool {
        *self.workspace.mentions_found.lock_recover()
    }
    fn list_worktrees<'a>(&'a self, _project_path: &'a str) -> BoxFuture<'a, Vec<WorktreeEntry>> {
        self.workspace.list_calls.fetch_add(1, Ordering::SeqCst);
        let entries = self.workspace.listing.lock_recover().clone();
        Box::pin(async move { entries })
    }
}
