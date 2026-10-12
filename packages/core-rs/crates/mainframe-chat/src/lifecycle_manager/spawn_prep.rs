//! Spawn-prep steps extracted out of `do_start_chat` — a child module of
//! `lifecycle_manager` (declared `mod spawn_prep;` there) so this `impl` block
//! can still reach `ChatLifecycleManager`'s private fields. `do_start_chat`
//! gains two call lines instead of growing these inline: resolving the
//! effective cwd (ensuring a non-project chat's scratch directory along the
//! way) and the no-persistence decision, then applying that decision's flag
//! write + active-cell mirror.
use mainframe_types::chat_patch::ChatPatch;
use mainframe_types::sync::LockExt as _;
use std::sync::{Arc, Mutex};

use mainframe_types::chat::Chat;
use mainframe_types::http_status::NotFound;

use crate::chat_cwd::chat_cwd;
use crate::no_persistence;
use crate::types::ActiveChat;

use super::{ChatLifecycleManager, LifecycleError};

/// The per-spawn cwd + persistence decision.
pub(super) struct SpawnPlan {
    pub(super) cwd: String,
    pub(super) no_persistence: bool,
}

impl ChatLifecycleManager {
    /// Resolves `chat`'s effective spawn cwd (a non-project chat's scratch
    /// directory is ensured to exist, created lazily on first use and
    /// recreated if deleted since) and the no-persistence decision.
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
        .ok_or_else(|| NotFound::new("Project", chat.project_id.clone()))?;
        // A non-project chat has no project directory to check — its cwd is
        // its own scratch path, ensured to exist just below.
        if chat.worktree_path.is_none() && !chat.no_project && !self.shared.deps.path_exists(&cwd) {
            return Err(LifecycleError::ProjectDirMissing(cwd));
        }
        if let Some(scratch) = chat.scratch_path.clone() {
            self.shared.deps.ensure_dir(&scratch).await;
        }
        let no_persistence = no_persistence::no_persistence_for_spawn(
            chat.temporary,
            self.shared
                .deps
                .adapter_supports_no_persistence(&chat.adapter_id),
        );
        Ok(SpawnPlan {
            cwd,
            no_persistence,
        })
    }

    /// Persists the no-persistence flag and mirrors it into the active cell before
    /// the spawn, so `on_init`'s stored provider id lands with the right ephemeral
    /// flag already in place.
    pub(super) fn apply_no_persistence_flag(
        &self,
        chat_id: &str,
        cell: &Arc<Mutex<ActiveChat>>,
        no_persistence: bool,
    ) {
        storage_event!(
            self.shared, Some(chat_id);
            self.shared.deps.chats_update(
                chat_id,
                &ChatPatch {
                    vendor_session_ephemeral: Some(no_persistence),
                    ..Default::default()
                },
            )
        );
        cell.lock_recover().chat.vendor_session_ephemeral = no_persistence;
    }
}
