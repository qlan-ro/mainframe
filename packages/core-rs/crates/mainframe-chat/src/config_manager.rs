//! Ported from `packages/core/src/chat/config-manager.ts`.

use std::sync::{Arc, Mutex};

use mainframe_adapter_api::{AdapterError, AdapterSession, BoxFuture};
use mainframe_services::workspace::{
    create_worktree, get_claude_project_dir, move_session_files, remove_worktree,
};
use mainframe_types::chat::Project;
use mainframe_types::events::DaemonEvent;
use mainframe_types::settings::{ExecutionMode, GeneralConfig};
use tracing::warn;

use crate::types::ActiveChat;

/// Errors surfaced by config changes. The message strings cross the wire
/// (routes surface them), so they are copied verbatim from the TS `throw`s.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Adapter(#[from] AdapterError),
}

/// A partial `Chat` patch (mirrors the `Partial<Chat>` the TS passes to
/// `db.chats.update`). Worktree fields are `Option<Option<String>>` so a clear
/// (set-to-undefined) is distinct from "leave unchanged".
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ChatFieldUpdate {
    pub adapter_id: Option<String>,
    pub model: Option<String>,
    pub permission_mode: Option<ExecutionMode>,
    pub plan_mode: Option<bool>,
    pub worktree_path: Option<Option<String>>,
    pub branch_name: Option<Option<String>>,
}

/// Injected dependency surface — mirrors the TS `ConfigManagerDeps` object.
///
/// `getActiveChat` returns the shared per-chat cell (`Arc<Mutex<ActiveChat>>`);
/// the manager mutates `active.chat` in place under a short lock and never holds
/// it across `.await` (CONCURRENCY rule 3). The `db`/`adapters` fields collapse
/// into the narrow methods actually used (no not-Send `mainframe-db` repo here).
pub trait ConfigManagerDeps: Send + Sync {
    fn get_active_chat(&self, chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>>;
    fn chats_update(&self, chat_id: &str, updates: &ChatFieldUpdate);
    fn projects_get(&self, project_id: &str) -> Option<Project>;
    fn settings_get(&self, ns: &str, key: &str) -> Option<String>;
    fn emit_event(&self, event: DaemonEvent);
    fn start_chat<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()>;
    fn stop_chat<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()>;
    /// Re-resolve tuning against the (possibly new) model and apply to the live session.
    fn apply_tuning<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()>;
    /// Stop launch processes for a project+path pair (`stopLaunchProcesses?`).
    fn stop_launch_processes<'a>(
        &'a self,
        project_id: &'a str,
        project_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>>;
    /// The in-flight spawn single-flight guard (`startingChats.get(chatId)`).
    fn take_starting_chat<'a>(&'a self, chat_id: &'a str) -> Option<BoxFuture<'a, ()>>;
}

struct LiveChanges {
    model: Option<String>,
    permission_mode: Option<ExecutionMode>,
    plan_mode: Option<bool>,
}

struct RespawnChanges {
    adapter_id: Option<String>,
    model: Option<String>,
    permission_mode: Option<ExecutionMode>,
    plan_mode: Option<bool>,
}

pub struct ChatConfigManager<D: ConfigManagerDeps> {
    deps: D,
}

impl<D: ConfigManagerDeps> ChatConfigManager<D> {
    pub fn new(deps: D) -> Self {
        Self { deps }
    }

    fn require_active_chat(&self, chat_id: &str) -> Result<Arc<Mutex<ActiveChat>>, ConfigError> {
        self.deps
            .get_active_chat(chat_id)
            .ok_or_else(|| ConfigError::Message(format!("Chat {chat_id} not found")))
    }

    /// Kill the spawned adapter session, if any, and detach it from the active chat.
    async fn detach_session(&self, cell: &Arc<Mutex<ActiveChat>>) -> Result<(), ConfigError> {
        let session = cell
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .session
            .clone();
        if let Some(session) = session
            && session.is_spawned()
        {
            session.kill().await?;
            cell.lock().unwrap_or_else(|e| e.into_inner()).session = None;
        }
        Ok(())
    }

    /// Each setting is applied and persisted INDEPENDENTLY: a rejected/timed-out setModel()
    /// (which now awaits and throws — see session.ts) must not skip setPermissionMode or
    /// setPlanMode, and must not 500 the whole request. Only settings the CLI actually
    /// accepted get written to the DB.
    async fn apply_live_session_settings(
        &self,
        chat_id: &str,
        cell: &Arc<Mutex<ActiveChat>>,
        session: &Arc<dyn AdapterSession>,
        changes: LiveChanges,
    ) {
        // TS `applyLiveSetting<K>` is generic over an async setter closure; Rust
        // async-closure-in-generic is unergonomic, so the three settings are
        // unrolled with identical control flow (try setter → stage into
        // updates/active.chat on Ok, warn on Err).
        let mut updates = ChatFieldUpdate::default();

        if let Some(model) = changes.model {
            match session.set_model(model.clone()).await {
                Ok(()) => {
                    updates.model = Some(model.clone());
                    cell.lock().unwrap_or_else(|e| e.into_inner()).chat.model = Some(model);
                }
                Err(err) => warn!(?err, chat_id, "setModel rejected; not persisting model"),
            }
        }
        if let Some(mode) = changes.permission_mode {
            match session.set_permission_mode(mode).await {
                Ok(()) => {
                    updates.permission_mode = Some(mode);
                    cell.lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .chat
                        .permission_mode = Some(mode);
                }
                Err(err) => {
                    warn!(
                        ?err,
                        chat_id, "setPermissionMode rejected; not persisting permissionMode"
                    )
                }
            }
        }
        if let Some(plan) = changes.plan_mode {
            match session.set_plan_mode(plan).await {
                Ok(()) => {
                    updates.plan_mode = Some(plan);
                    cell.lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .chat
                        .plan_mode = Some(plan);
                }
                Err(err) => warn!(
                    ?err,
                    chat_id, "setPlanMode rejected; not persisting planMode"
                ),
            }
        }

        if updates == ChatFieldUpdate::default() {
            return;
        }
        self.deps.chats_update(chat_id, &updates);
        // Model switch can invalidate the live tuning (e.g. xhigh/ultracode on a model that
        // doesn't support them). Re-resolve against the new model and re-apply.
        if updates.model.is_some() {
            self.deps.apply_tuning(chat_id).await;
        }
        let chat = cell.lock().unwrap_or_else(|e| e.into_inner()).chat.clone();
        self.deps
            .emit_event(DaemonEvent::ChatUpdated { chat, reason: None });
    }

    /// Config change that needs a respawn: an adapter switch, or any setting change while no live
    /// session exists yet to apply it to directly. Waits out an in-flight spawn, kills the current
    /// session, persists the new settings, then restarts if a session had been running.
    async fn respawn_with_config(
        &self,
        chat_id: &str,
        cell: &Arc<Mutex<ActiveChat>>,
        changes: RespawnChanges,
    ) -> Result<(), ConfigError> {
        if let Some(inflight) = self.deps.take_starting_chat(chat_id) {
            // spawn may have failed — the guard future carries no error here.
            inflight.await;
        }

        let session = cell
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .session
            .clone();
        let was_spawned = session.as_ref().is_some_and(|s| s.is_spawned());
        if was_spawned {
            if let Some(session) = &session {
                session.kill().await?;
            }
            cell.lock().unwrap_or_else(|e| e.into_inner()).session = None;
        }

        let mut updates = ChatFieldUpdate::default();
        {
            let mut guard = cell.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(adapter_id) = changes.adapter_id {
                updates.adapter_id = Some(adapter_id.clone());
                guard.chat.adapter_id = adapter_id;
            }
            if let Some(model) = changes.model {
                updates.model = Some(model.clone());
                guard.chat.model = Some(model);
            }
            if let Some(mode) = changes.permission_mode {
                updates.permission_mode = Some(mode);
                guard.chat.permission_mode = Some(mode);
            }
            if let Some(plan) = changes.plan_mode {
                updates.plan_mode = Some(plan);
                guard.chat.plan_mode = Some(plan);
            }
        }

        self.deps.chats_update(chat_id, &updates);
        let chat = cell.lock().unwrap_or_else(|e| e.into_inner()).chat.clone();
        self.deps
            .emit_event(DaemonEvent::ChatUpdated { chat, reason: None });
        if was_spawned {
            self.deps.start_chat(chat_id).await;
        }
        Ok(())
    }

    /// Persist a worktree path/branch change (`None` clears it) and broadcast it.
    fn apply_worktree_update(
        &self,
        cell: &Arc<Mutex<ActiveChat>>,
        chat_id: &str,
        worktree_path: Option<String>,
        branch_name: Option<String>,
    ) {
        {
            let mut guard = cell.lock().unwrap_or_else(|e| e.into_inner());
            guard.chat.worktree_path = worktree_path.clone();
            guard.chat.branch_name = branch_name.clone();
        }
        self.deps.chats_update(
            chat_id,
            &ChatFieldUpdate {
                worktree_path: Some(worktree_path),
                branch_name: Some(branch_name),
                ..Default::default()
            },
        );
        let chat = cell.lock().unwrap_or_else(|e| e.into_inner()).chat.clone();
        self.deps
            .emit_event(DaemonEvent::ChatUpdated { chat, reason: None });
    }

    pub async fn update_chat_config(
        &self,
        chat_id: &str,
        adapter_id: Option<String>,
        model: Option<String>,
        permission_mode: Option<ExecutionMode>,
        plan_mode: Option<bool>,
    ) -> Result<(), ConfigError> {
        let cell = self.require_active_chat(chat_id)?;

        let (cur_adapter, cur_model, cur_mode, cur_plan, has_claude_session, session) = {
            let guard = cell.lock().unwrap_or_else(|e| e.into_inner());
            (
                guard.chat.adapter_id.clone(),
                guard.chat.model.clone(),
                guard.chat.permission_mode,
                guard.chat.plan_mode,
                guard.chat.claude_session_id.is_some(),
                guard.session.clone(),
            )
        };

        if let Some(ref new_adapter) = adapter_id
            && *new_adapter != cur_adapter
            && has_claude_session
        {
            return Err(ConfigError::Message(
                "Cannot change adapter after a session has started".to_string(),
            ));
        }

        let adapter_changed = adapter_id.as_ref().is_some_and(|a| *a != cur_adapter);
        let model_changed = match &model {
            Some(m) => cur_model.as_deref() != Some(m.as_str()),
            None => false,
        };
        let mode_changed = match permission_mode {
            Some(pm) => cur_mode != Some(pm),
            None => false,
        };
        let plan_mode_changed = match plan_mode {
            Some(pm) => pm != cur_plan.unwrap_or(false),
            None => false,
        };
        if !adapter_changed && !model_changed && !mode_changed && !plan_mode_changed {
            return Ok(());
        }

        let session_spawned = session.as_ref().is_some_and(|s| s.is_spawned());
        if session_spawned && !adapter_changed {
            // `session_spawned` implies `Some`; the `if let` avoids an Option unwrap.
            if let Some(session) = session {
                self.apply_live_session_settings(
                    chat_id,
                    &cell,
                    &session,
                    LiveChanges {
                        model: if model_changed { model } else { None },
                        permission_mode: if mode_changed { permission_mode } else { None },
                        plan_mode: if plan_mode_changed { plan_mode } else { None },
                    },
                )
                .await;
            }
            return Ok(());
        }

        self.respawn_with_config(
            chat_id,
            &cell,
            RespawnChanges {
                adapter_id: if adapter_changed { adapter_id } else { None },
                model: if model_changed { model } else { None },
                permission_mode: if mode_changed { permission_mode } else { None },
                plan_mode: if plan_mode_changed { plan_mode } else { None },
            },
        )
        .await
    }

    fn worktree_dir(&self) -> String {
        self.deps
            .settings_get("general", "worktreeDir")
            .unwrap_or_else(|| GeneralConfig::default().worktree_dir)
    }

    pub async fn enable_worktree(
        &self,
        chat_id: &str,
        base_branch: &str,
        branch_name: &str,
    ) -> Result<(), ConfigError> {
        let cell = self.require_active_chat(chat_id)?;
        let (has_worktree, project_id, claude_session_id, adapter) = {
            let guard = cell.lock().unwrap_or_else(|e| e.into_inner());
            (
                guard.chat.worktree_path.is_some(),
                guard.chat.project_id.clone(),
                guard.chat.claude_session_id.clone(),
                guard.chat.adapter_id.clone(),
            )
        };
        if has_worktree {
            return Ok(());
        }

        let project = self
            .deps
            .projects_get(&project_id)
            .ok_or_else(|| ConfigError::Message("Project not found".to_string()))?;

        if let Some(session_id) = claude_session_id {
            // Mid-session path: stop, create worktree, move session files (claude only), restart.
            // Codex resumes by threadId + cwd and stores rollouts under ~/.codex/sessions/<date>/
            // (not project-keyed), so there is nothing to relocate.
            self.deps.stop_chat(chat_id).await;

            let info = create_worktree(
                &project.path,
                &self.worktree_dir(),
                base_branch,
                branch_name,
            )
            .await
            .map_err(|e| ConfigError::Message(e.to_string()))?;

            if adapter == "claude" {
                let old_dir = get_claude_project_dir(&project.path);
                let new_dir = get_claude_project_dir(&info.worktree_path);
                move_session_files(
                    &session_id,
                    &old_dir.to_string_lossy(),
                    &new_dir.to_string_lossy(),
                )
                .await
                .map_err(|e| ConfigError::Message(e.to_string()))?;
            }

            self.apply_worktree_update(
                &cell,
                chat_id,
                Some(info.worktree_path),
                Some(info.branch_name),
            );
            self.deps.start_chat(chat_id).await;
            return Ok(());
        }

        // Pre-session path: kill any untracked process and create worktree
        self.detach_session(&cell).await?;

        let info = create_worktree(
            &project.path,
            &self.worktree_dir(),
            base_branch,
            branch_name,
        )
        .await
        .map_err(|e| ConfigError::Message(e.to_string()))?;
        self.apply_worktree_update(
            &cell,
            chat_id,
            Some(info.worktree_path),
            Some(info.branch_name),
        );
        Ok(())
    }

    pub async fn attach_worktree(
        &self,
        chat_id: &str,
        worktree_path: &str,
        branch_name: &str,
    ) -> Result<(), ConfigError> {
        let cell = self.require_active_chat(chat_id)?;
        let (has_worktree, project_id, claude_session_id, adapter) = {
            let guard = cell.lock().unwrap_or_else(|e| e.into_inner());
            (
                guard.chat.worktree_path.is_some(),
                guard.chat.project_id.clone(),
                guard.chat.claude_session_id.clone(),
                guard.chat.adapter_id.clone(),
            )
        };
        if has_worktree {
            return Ok(());
        }

        if let Some(session_id) = claude_session_id {
            // Mid-session path: stop, move session files to attached worktree, restart
            let project = self
                .deps
                .projects_get(&project_id)
                .ok_or_else(|| ConfigError::Message("Project not found".to_string()))?;

            self.deps.stop_chat(chat_id).await;

            if adapter == "claude" {
                let old_dir = get_claude_project_dir(&project.path);
                let new_dir = get_claude_project_dir(worktree_path);
                move_session_files(
                    &session_id,
                    &old_dir.to_string_lossy(),
                    &new_dir.to_string_lossy(),
                )
                .await
                .map_err(|e| ConfigError::Message(e.to_string()))?;
            }

            self.apply_worktree_update(
                &cell,
                chat_id,
                Some(worktree_path.to_string()),
                Some(branch_name.to_string()),
            );
            self.deps.start_chat(chat_id).await;
            return Ok(());
        }

        // Pre-session path
        self.detach_session(&cell).await?;
        self.apply_worktree_update(
            &cell,
            chat_id,
            Some(worktree_path.to_string()),
            Some(branch_name.to_string()),
        );
        Ok(())
    }

    pub async fn disable_worktree(&self, chat_id: &str) -> Result<(), ConfigError> {
        let Some(cell) = self.deps.get_active_chat(chat_id) else {
            return Ok(());
        };
        let (worktree_path, has_claude_session, project_id, branch_name) = {
            let guard = cell.lock().unwrap_or_else(|e| e.into_inner());
            (
                guard.chat.worktree_path.clone(),
                guard.chat.claude_session_id.is_some(),
                guard.chat.project_id.clone(),
                guard.chat.branch_name.clone(),
            )
        };
        let Some(worktree_path) = worktree_path else {
            return Ok(());
        };
        if has_claude_session {
            return Err(ConfigError::Message(
                "Cannot disable worktree after session has started".to_string(),
            ));
        }

        self.detach_session(&cell).await?;

        if let Some(fut) = self.deps.stop_launch_processes(&project_id, &worktree_path) {
            fut.await;
        }

        if let Some(project) = self.deps.projects_get(&project_id) {
            remove_worktree(
                &project.path,
                &worktree_path,
                branch_name.as_deref().unwrap_or_default(),
            )
            .await;
        }

        self.apply_worktree_update(&cell, chat_id, None, None);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{FakeSession, test_chat};
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct FakeDeps {
        cell: Arc<Mutex<ActiveChat>>,
        updates: Mutex<Vec<ChatFieldUpdate>>,
        events: Mutex<Vec<DaemonEvent>>,
        apply_tuning_calls: AtomicUsize,
    }

    impl FakeDeps {
        fn new(cell: Arc<Mutex<ActiveChat>>) -> Self {
            Self {
                cell,
                updates: Mutex::new(Vec::new()),
                events: Mutex::new(Vec::new()),
                apply_tuning_calls: AtomicUsize::new(0),
            }
        }
    }

    impl ConfigManagerDeps for FakeDeps {
        fn get_active_chat(&self, _chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
            Some(self.cell.clone())
        }
        fn chats_update(&self, _chat_id: &str, updates: &ChatFieldUpdate) {
            self.updates.lock().unwrap().push(updates.clone());
        }
        fn projects_get(&self, _project_id: &str) -> Option<Project> {
            None
        }
        fn settings_get(&self, _ns: &str, _key: &str) -> Option<String> {
            None
        }
        fn emit_event(&self, event: DaemonEvent) {
            self.events.lock().unwrap().push(event);
        }
        fn start_chat<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, ()> {
            Box::pin(async {})
        }
        fn stop_chat<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, ()> {
            Box::pin(async {})
        }
        fn apply_tuning<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, ()> {
            self.apply_tuning_calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(async {})
        }
        fn stop_launch_processes<'a>(
            &'a self,
            _project_id: &'a str,
            _project_path: &'a str,
        ) -> Option<BoxFuture<'a, ()>> {
            None
        }
        fn take_starting_chat<'a>(&'a self, _chat_id: &'a str) -> Option<BoxFuture<'a, ()>> {
            None
        }
    }

    fn cell_with(session: Arc<FakeSession>) -> Arc<Mutex<ActiveChat>> {
        Arc::new(Mutex::new(ActiveChat {
            chat: test_chat("c1"),
            session: Some(session),
            turn_started_at: None,
        }))
    }

    // Ports config-manager.test.ts assertion-for-assertion.
    #[tokio::test]
    async fn persists_permission_mode_even_when_set_model_rejects() {
        let session = Arc::new(FakeSession {
            set_model_ok: false,
            set_permission_mode_ok: true,
            ..FakeSession::spawned()
        });
        let cell = cell_with(session.clone());
        let deps = FakeDeps::new(cell.clone());
        let manager = ChatConfigManager::new(deps);

        manager
            .update_chat_config(
                "c1",
                None,
                Some("new-model".to_string()),
                Some(ExecutionMode::AcceptEdits),
                None,
            )
            .await
            .unwrap();

        assert_eq!(
            session.set_model_calls.lock().unwrap().as_slice(),
            &["new-model".to_string()]
        );
        assert_eq!(
            session.set_permission_mode_calls.lock().unwrap().as_slice(),
            &[ExecutionMode::AcceptEdits]
        );
        let updates = manager.deps.updates.lock().unwrap();
        assert_eq!(
            updates.as_slice(),
            &[ChatFieldUpdate {
                permission_mode: Some(ExecutionMode::AcceptEdits),
                ..Default::default()
            }]
        );
        let chat = cell.lock().unwrap().chat.clone();
        assert_eq!(chat.model.as_deref(), Some("old-model")); // rejected — not applied
        assert_eq!(chat.permission_mode, Some(ExecutionMode::AcceptEdits)); // succeeded — applied
        assert_eq!(manager.deps.apply_tuning_calls.load(Ordering::SeqCst), 0); // model didn't change
        let events = manager.deps.events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert!(
            matches!(&events[0], DaemonEvent::ChatUpdated { chat: c, reason: None } if c.permission_mode == Some(ExecutionMode::AcceptEdits))
        );
    }

    #[tokio::test]
    async fn does_not_persist_or_emit_when_every_setting_rejects() {
        let session = Arc::new(FakeSession {
            set_model_ok: false,
            ..FakeSession::spawned()
        });
        let cell = cell_with(session);
        let deps = FakeDeps::new(cell);
        let manager = ChatConfigManager::new(deps);

        manager
            .update_chat_config("c1", None, Some("new-model".to_string()), None, None)
            .await
            .unwrap();

        assert!(manager.deps.updates.lock().unwrap().is_empty());
        assert!(manager.deps.events.lock().unwrap().is_empty());
    }
}

// PORT STATUS: src/chat/config-manager.ts (270 lines)
// confidence: medium
// todos: 0
// notes: TS `ConfigManagerDeps` DI object → `ConfigManagerDeps` trait; `getActiveChat`
// notes: returns the shared `Arc<Mutex<ActiveChat>>` cell (CONCURRENCY.tsv PER_ENTITY),
// notes: mutated under short locks with session I/O + emitEvent kept OUTSIDE the lock
// notes: (rule 3). The generic `applyLiveSetting<K>` is unrolled into three identical
// notes: blocks (async-closure-in-generic is unergonomic); warn strings ("setModel
// notes: rejected; not persisting model" etc.) copied verbatim. `startingChats` →
// notes: `take_starting_chat` single-flight seam; `setStopLaunchProcesses` late-bind
// notes: setter dropped (the trait method covers it). start/stop/applyTuning deps
// notes: futures are infallible here (TS Promise<void> rejection propagation is a
// notes: seam chat_manager wires). Both config-manager.test.ts cases ported. `db`
// notes: is narrow trait methods (no not-Send mainframe-db repo); workspace fns come
// notes: from mainframe-services directly.
