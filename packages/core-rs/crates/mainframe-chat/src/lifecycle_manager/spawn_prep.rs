//! Rule 6/7 (todo #346) spawn-prep steps extracted out of `do_start_chat` — a
//! child module of `lifecycle_manager` (declared `mod spawn_prep;` there) so
//! this `impl` block can still reach `ChatLifecycleManager`'s private fields.
//! `do_start_chat` gains two call lines instead of growing these inline:
//! resolving the effective cwd (ensuring a non-project chat's scratch
//! directory along the way, rule 6) and the no-persistence decision (rule 7),
//! then applying that decision's flag write + active-cell mirror.
use std::sync::{Arc, Mutex};

use mainframe_types::chat::Chat;

use crate::chat_cwd::chat_cwd;
use crate::no_persistence;
use crate::types::ActiveChat;

use super::{ChatLifecycleManager, LifecycleChatUpdate, LifecycleError, LifecycleManagerDeps};

/// The per-spawn cwd + persistence decision (rule 6/7).
pub(super) struct SpawnPlan {
    pub(super) cwd: String,
    pub(super) no_persistence: bool,
}

impl<D: LifecycleManagerDeps + 'static> ChatLifecycleManager<D> {
    /// Resolves `chat`'s effective spawn cwd (rule 6: a non-project chat's
    /// scratch directory is ensured to exist, created lazily on first use and
    /// recreated if deleted since) and rule 7's no-persistence decision.
    pub(super) async fn resolve_spawn_plan(
        &self,
        chat: &Chat,
        project_path: Option<String>,
    ) -> Result<SpawnPlan, LifecycleError> {
        let cwd = chat_cwd(
            chat.worktree_path.as_deref(),
            chat.scratch_path.as_deref(),
            project_path,
        )
        .ok_or_else(|| LifecycleError::Message(format!("Project {} not found", chat.project_id)))?;
        // A non-project chat has no project directory to check — its cwd is
        // its own scratch path, ensured to exist just below.
        if chat.worktree_path.is_none() && !chat.no_project && !self.deps.path_exists(&cwd) {
            return Err(LifecycleError::Message(format!(
                "Project directory does not exist or is not accessible: {cwd}"
            )));
        }
        if let Some(scratch) = chat.scratch_path.clone() {
            self.deps.ensure_dir(&scratch).await;
        }
        let no_persistence = no_persistence::no_persistence_for_spawn(
            chat.temporary,
            self.deps.adapter_supports_no_persistence(&chat.adapter_id),
        );
        Ok(SpawnPlan {
            cwd,
            no_persistence,
        })
    }

    /// Persists rule 7's flag write and mirrors it into the active cell before
    /// the spawn, so `on_init`'s stored provider id lands with the right
    /// ephemeral flag already in place.
    pub(super) fn apply_no_persistence_flag(
        &self,
        chat_id: &str,
        cell: &Arc<Mutex<ActiveChat>>,
        no_persistence: bool,
    ) {
        self.deps.chats_update(
            chat_id,
            &LifecycleChatUpdate {
                vendor_session_ephemeral: Some(no_persistence),
                ..Default::default()
            },
        );
        cell.lock()
            .unwrap_or_else(|e| e.into_inner())
            .chat
            .vendor_session_ephemeral = no_persistence;
    }
}

// PORT STATUS: NEW module, split out of lifecycle_manager.rs (todo #346 review
// fix)
// confidence: high
// todos: 0
// notes: pure extraction — `do_start_chat` calls `resolve_spawn_plan` where the
// notes: cwd-resolve/no-project-dir-check/ensure_dir/no-persistence-decision block
// notes: used to sit inline, and `apply_no_persistence_flag` where the flag write +
// notes: active-cell mirror did; no behavior change.
