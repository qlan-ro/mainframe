//! Ported from `packages/core/src/chat/config-manager.ts`.

use std::sync::{Arc, Mutex};

use mainframe_adapter_api::{AdapterError, AdapterSession, BoxFuture};
use mainframe_services::workspace::{
    create_worktree, get_claude_project_dir, move_session_files, remove_worktree,
};
use mainframe_types::adapter::model_endpoint;
use mainframe_types::chat::Project;
use mainframe_types::events::DaemonEvent;
use mainframe_types::settings::{ExecutionMode, GeneralConfig};
use tracing::warn;

use crate::event_handler::compute_session_file_path;
use crate::types::ActiveChat;

/// Errors surfaced by config changes. The message strings cross the wire
/// (routes surface them), so they are copied verbatim from the TS `throw`s.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("{0}")]
    Message(String),
    /// Rebinding stops and restarts the CLI, which would cut a turn off mid-answer.
    #[error("Finish or stop the current response before switching worktrees")]
    ChatBusy,
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
    pub session_file_path: Option<String>,
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
    /// Fired after a binding change persists — the offer registry's single
    /// source of `resolved{accepted}`.
    fn on_binding_changed(&self, _chat_id: &str, _worktree_path: Option<&str>) {}
    /// Relocate a Claude session's transcript files between project dirs. A seam
    /// only so tests can exercise the failure path without touching a real `$HOME`.
    fn move_claude_session_files<'a>(
        &'a self,
        session_id: &'a str,
        old_dir: &'a str,
        new_dir: &'a str,
    ) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
            move_session_files(session_id, old_dir, new_dir)
                .await
                .map_err(|e| e.to_string())
        })
    }
}

/// The chat's current effective directory: its worktree when bound, else the project root.
fn effective_dir<'a>(current_worktree: Option<&'a str>, project_path: &'a str) -> &'a str {
    current_worktree.unwrap_or(project_path)
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
    /// `session_file_path` is `Some` only when a transcript was just relocated —
    /// the stored path points into the old project dir until it is rewritten.
    fn apply_worktree_update(
        &self,
        cell: &Arc<Mutex<ActiveChat>>,
        chat_id: &str,
        worktree_path: Option<String>,
        branch_name: Option<String>,
        session_file_path: Option<String>,
    ) {
        {
            let mut guard = cell.lock().unwrap_or_else(|e| e.into_inner());
            guard.chat.worktree_path = worktree_path.clone();
            guard.chat.branch_name = branch_name.clone();
            if session_file_path.is_some() {
                guard.chat.session_file_path = session_file_path.clone();
            }
        }
        self.deps.chats_update(
            chat_id,
            &ChatFieldUpdate {
                worktree_path: Some(worktree_path.clone()),
                branch_name: Some(branch_name),
                session_file_path,
                ..Default::default()
            },
        );
        let chat = cell.lock().unwrap_or_else(|e| e.into_inner()).chat.clone();
        self.deps
            .emit_event(DaemonEvent::ChatUpdated { chat, reason: None });
        self.deps
            .on_binding_changed(chat_id, worktree_path.as_deref());
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

        // The endpoint a model runs against is fixed in the child's environment at
        // spawn, so crossing endpoints needs a respawn even though the adapter is
        // unchanged — `set_model` alone would leave the CLI pointed at the old one.
        let endpoint_changed = model_changed
            && model.as_deref().and_then(model_endpoint)
                != cur_model.as_deref().and_then(model_endpoint);

        let session_spawned = session.as_ref().is_some_and(|s| s.is_spawned());
        if session_spawned && !adapter_changed && !endpoint_changed {
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

            let mut moved_transcript = None;
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
                moved_transcript =
                    Some(compute_session_file_path(&info.worktree_path, &session_id));
            }

            self.apply_worktree_update(
                &cell,
                chat_id,
                Some(info.worktree_path),
                Some(info.branch_name),
                moved_transcript,
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
            None,
        );
        Ok(())
    }

    /// Bind the chat to `worktree_path`, rebinding it from whatever it is on now.
    /// `branch_name: None` persists a null branch (a detached worktree).
    pub async fn attach_worktree(
        &self,
        chat_id: &str,
        worktree_path: &str,
        branch_name: Option<&str>,
    ) -> Result<(), ConfigError> {
        let cell = self.require_active_chat(chat_id)?;
        let (current_worktree, project_id, claude_session_id, adapter) = {
            let guard = cell.lock().unwrap_or_else(|e| e.into_inner());
            (
                guard.chat.worktree_path.clone(),
                guard.chat.project_id.clone(),
                guard.chat.claude_session_id.clone(),
                guard.chat.adapter_id.clone(),
            )
        };
        if current_worktree.as_deref() == Some(worktree_path) {
            return Ok(());
        }
        let branch_name = branch_name.map(str::to_string);

        if let Some(session_id) = claude_session_id {
            // Mid-session path: stop, move session files to attached worktree, restart
            let project = self
                .deps
                .projects_get(&project_id)
                .ok_or_else(|| ConfigError::Message("Project not found".to_string()))?;

            self.deps.stop_chat(chat_id).await;

            // Same blast radius as `disable_worktree`: the whole (project, path)
            // launch manager, not just this chat's processes.
            if let Some(old) = current_worktree.as_deref()
                && let Some(fut) = self.deps.stop_launch_processes(&project_id, old)
            {
                fut.await;
            }

            let mut moved_transcript = None;
            if adapter == "claude" {
                let old_dir = get_claude_project_dir(effective_dir(
                    current_worktree.as_deref(),
                    &project.path,
                ));
                let new_dir = get_claude_project_dir(worktree_path);
                if let Err(err) = self
                    .deps
                    .move_claude_session_files(
                        &session_id,
                        &old_dir.to_string_lossy(),
                        &new_dir.to_string_lossy(),
                    )
                    .await
                {
                    // The chat is already stopped at this point — leaving it that way
                    // would strand the session with no running CLI and no new binding.
                    tracing::error!(
                        chat_id,
                        worktree_path,
                        error = %err,
                        "failed to move session files; restarting the chat on its current binding"
                    );
                    self.deps.start_chat(chat_id).await;
                    return Err(ConfigError::Message(
                        "Moving the session's history into the worktree failed. The session stayed where it was.".to_string(),
                    ));
                }
                moved_transcript = Some(compute_session_file_path(worktree_path, &session_id));
            }

            self.apply_worktree_update(
                &cell,
                chat_id,
                Some(worktree_path.to_string()),
                branch_name,
                moved_transcript,
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
            branch_name,
            None,
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

        self.apply_worktree_update(&cell, chat_id, None, None, None);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{FakeSession, test_chat};
    use mainframe_types::chat::Chat;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct FakeDeps {
        cell: Arc<Mutex<ActiveChat>>,
        updates: Mutex<Vec<ChatFieldUpdate>>,
        events: Mutex<Vec<DaemonEvent>>,
        apply_tuning_calls: AtomicUsize,
        project: Option<Project>,
        start_chat_calls: AtomicUsize,
        stop_chat_calls: AtomicUsize,
        stop_launch_calls: Mutex<Vec<(String, String)>>,
        binding_changed: Mutex<Vec<Option<String>>>,
        move_files_error: Option<String>,
    }

    impl FakeDeps {
        fn new(cell: Arc<Mutex<ActiveChat>>) -> Self {
            Self {
                cell,
                updates: Mutex::new(Vec::new()),
                events: Mutex::new(Vec::new()),
                apply_tuning_calls: AtomicUsize::new(0),
                project: None,
                start_chat_calls: AtomicUsize::new(0),
                stop_chat_calls: AtomicUsize::new(0),
                stop_launch_calls: Mutex::new(Vec::new()),
                binding_changed: Mutex::new(Vec::new()),
                move_files_error: None,
            }
        }

        fn with_project(cell: Arc<Mutex<ActiveChat>>, project: Project) -> Self {
            Self {
                project: Some(project),
                ..Self::new(cell)
            }
        }

        fn failing_move(cell: Arc<Mutex<ActiveChat>>, project: Project, error: &str) -> Self {
            Self {
                move_files_error: Some(error.to_string()),
                ..Self::with_project(cell, project)
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
            self.project.clone()
        }
        fn settings_get(&self, _ns: &str, _key: &str) -> Option<String> {
            None
        }
        fn emit_event(&self, event: DaemonEvent) {
            self.events.lock().unwrap().push(event);
        }
        fn start_chat<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, ()> {
            self.start_chat_calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(async {})
        }
        fn stop_chat<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, ()> {
            self.stop_chat_calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(async {})
        }
        fn apply_tuning<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, ()> {
            self.apply_tuning_calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(async {})
        }
        fn stop_launch_processes<'a>(
            &'a self,
            project_id: &'a str,
            project_path: &'a str,
        ) -> Option<BoxFuture<'a, ()>> {
            self.stop_launch_calls
                .lock()
                .unwrap()
                .push((project_id.to_string(), project_path.to_string()));
            Some(Box::pin(async {}))
        }
        fn take_starting_chat<'a>(&'a self, _chat_id: &'a str) -> Option<BoxFuture<'a, ()>> {
            None
        }
        fn on_binding_changed(&self, _chat_id: &str, worktree_path: Option<&str>) {
            self.binding_changed
                .lock()
                .unwrap()
                .push(worktree_path.map(|s| s.to_string()));
        }
        fn move_claude_session_files<'a>(
            &'a self,
            _session_id: &'a str,
            _old_dir: &'a str,
            _new_dir: &'a str,
        ) -> BoxFuture<'a, Result<(), String>> {
            Box::pin(async move {
                match &self.move_files_error {
                    Some(err) => Err(err.clone()),
                    None => Ok(()),
                }
            })
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

    /// Crossing endpoints changes the child's environment, which only a respawn can
    /// do. A live `set_model` would leave the CLI talking to the old endpoint under
    /// a model id it has never heard of.
    #[tokio::test]
    async fn moving_a_live_chat_onto_an_endpoint_model_respawns_instead_of_setting_the_model() {
        let session = Arc::new(FakeSession::spawned());
        let cell = cell_with(session.clone());
        let manager = ChatConfigManager::new(FakeDeps::new(cell.clone()));

        manager
            .update_chat_config(
                "c1",
                None,
                Some("cliproxy/gpt-5.6-sol".to_string()),
                None,
                None,
            )
            .await
            .unwrap();

        assert!(session.set_model_calls.lock().unwrap().is_empty());
        assert_eq!(session.kills(), 1);
        assert_eq!(manager.deps.start_chat_calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            cell.lock().unwrap().chat.model.as_deref(),
            Some("cliproxy/gpt-5.6-sol")
        );
    }

    /// Within one endpoint the environment is already right, so the switch stays live.
    #[tokio::test]
    async fn switching_between_two_models_on_the_same_endpoint_stays_live() {
        let session = Arc::new(FakeSession::spawned());
        let cell = cell_with(session.clone());
        cell.lock().unwrap().chat.model = Some("cliproxy/gpt-5.6-sol".to_string());
        let manager = ChatConfigManager::new(FakeDeps::new(cell.clone()));

        manager
            .update_chat_config("c1", None, Some("cliproxy/kimi-k3".to_string()), None, None)
            .await
            .unwrap();

        assert_eq!(
            session.set_model_calls.lock().unwrap().as_slice(),
            &["cliproxy/kimi-k3".to_string()]
        );
        assert_eq!(session.kills(), 0);
        assert_eq!(manager.deps.start_chat_calls.load(Ordering::SeqCst), 0);
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

    fn worktreed_chat() -> Chat {
        let mut chat = test_chat("c1");
        chat.adapter_id = "codex".to_string();
        chat.claude_session_id = Some("sess1".to_string());
        chat.worktree_path = Some("/old/wt".to_string());
        chat.branch_name = Some("old-branch".to_string());
        chat
    }

    fn cell_with_chat(chat: Chat, session: Arc<FakeSession>) -> Arc<Mutex<ActiveChat>> {
        Arc::new(Mutex::new(ActiveChat {
            chat,
            session: Some(session),
            turn_started_at: None,
        }))
    }

    fn test_project() -> Project {
        Project {
            id: "p1".to_string(),
            name: "proj".to_string(),
            path: "/proj".to_string(),
            created_at: String::new(),
            last_opened_at: String::new(),
            parent_project_id: None,
            available: None,
        }
    }

    #[tokio::test]
    async fn rebinds_a_worktreed_chat_to_a_different_worktree() {
        let session = Arc::new(FakeSession::spawned());
        let cell = cell_with_chat(worktreed_chat(), session);
        let deps = FakeDeps::with_project(cell.clone(), test_project());
        let manager = ChatConfigManager::new(deps);

        manager
            .attach_worktree("c1", "/new/wt", Some("feat"))
            .await
            .unwrap();

        let updates = manager.deps.updates.lock().unwrap();
        assert_eq!(
            updates.as_slice(),
            &[ChatFieldUpdate {
                worktree_path: Some(Some("/new/wt".to_string())),
                branch_name: Some(Some("feat".to_string())),
                ..Default::default()
            }]
        );
        assert_eq!(
            manager.deps.start_chat_calls.load(Ordering::SeqCst),
            1,
            "expected start_chat to be called once to restart the chat in the new worktree"
        );
    }

    #[tokio::test]
    async fn attaching_the_same_worktree_path_is_a_no_op() {
        let session = Arc::new(FakeSession::spawned());
        let cell = cell_with_chat(worktreed_chat(), session);
        let deps = FakeDeps::with_project(cell.clone(), test_project());
        let manager = ChatConfigManager::new(deps);

        manager
            .attach_worktree("c1", "/old/wt", Some("old-branch"))
            .await
            .unwrap();

        assert_eq!(manager.deps.stop_chat_calls.load(Ordering::SeqCst), 0);
        assert!(manager.deps.updates.lock().unwrap().is_empty());
        assert!(manager.deps.events.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn rebinding_stops_launch_processes_for_the_old_worktree_path() {
        let session = Arc::new(FakeSession::spawned());
        let cell = cell_with_chat(worktreed_chat(), session);
        let deps = FakeDeps::with_project(cell.clone(), test_project());
        let manager = ChatConfigManager::new(deps);

        manager
            .attach_worktree("c1", "/new/wt", Some("feat"))
            .await
            .unwrap();

        let stop_launch_calls = manager.deps.stop_launch_calls.lock().unwrap();
        assert_eq!(
            stop_launch_calls.as_slice(),
            &[("p1".to_string(), "/old/wt".to_string())]
        );
    }

    fn claude_worktreed_chat() -> Chat {
        let mut chat = worktreed_chat();
        chat.adapter_id = "claude".to_string();
        chat
    }

    #[tokio::test]
    async fn repoints_the_stored_session_file_path_at_the_new_worktree() {
        let session = Arc::new(FakeSession::spawned());
        let cell = cell_with_chat(claude_worktreed_chat(), session);
        let deps = FakeDeps::with_project(cell.clone(), test_project());
        let manager = ChatConfigManager::new(deps);

        manager
            .attach_worktree("c1", "/new/wt", Some("feat"))
            .await
            .unwrap();

        let expected = dirs::home_dir()
            .unwrap()
            .join(".claude/projects/-new-wt/sess1.jsonl")
            .to_string_lossy()
            .to_string();
        assert_eq!(
            manager.deps.updates.lock().unwrap().as_slice(),
            &[ChatFieldUpdate {
                worktree_path: Some(Some("/new/wt".to_string())),
                branch_name: Some(Some("feat".to_string())),
                session_file_path: Some(expected.clone()),
                ..Default::default()
            }]
        );
        assert_eq!(
            cell.lock().unwrap().chat.session_file_path,
            Some(expected),
            "the broadcast chat must carry the new path, not the emptied directory"
        );
    }

    #[tokio::test]
    async fn restarts_the_chat_when_moving_session_files_fails() {
        let session = Arc::new(FakeSession::spawned());
        let cell = cell_with_chat(claude_worktreed_chat(), session);
        let deps = FakeDeps::failing_move(
            cell.clone(),
            test_project(),
            "No such file or directory (os error 2)",
        );
        let manager = ChatConfigManager::new(deps);

        let err = manager
            .attach_worktree("c1", "/new/wt", Some("feat"))
            .await
            .unwrap_err();

        assert_eq!(
            err.to_string(),
            "Moving the session's history into the worktree failed. The session stayed where it was.",
            "raw io text must not reach the user-facing toast"
        );
        assert_eq!(
            manager.deps.start_chat_calls.load(Ordering::SeqCst),
            1,
            "expected the stopped chat to be restarted rather than stranded"
        );
    }

    #[tokio::test]
    async fn keeps_the_old_binding_when_moving_session_files_fails() {
        let session = Arc::new(FakeSession::spawned());
        let cell = cell_with_chat(claude_worktreed_chat(), session);
        let deps = FakeDeps::failing_move(cell.clone(), test_project(), "boom");
        let manager = ChatConfigManager::new(deps);

        manager
            .attach_worktree("c1", "/new/wt", Some("feat"))
            .await
            .unwrap_err();

        assert!(manager.deps.updates.lock().unwrap().is_empty());
        assert!(manager.deps.binding_changed.lock().unwrap().is_empty());
        let chat = cell.lock().unwrap().chat.clone();
        assert_eq!(chat.worktree_path.as_deref(), Some("/old/wt"));
        assert_eq!(chat.branch_name.as_deref(), Some("old-branch"));
    }

    #[test]
    fn effective_dir_is_the_worktree_when_bound_else_the_project_path() {
        assert_eq!(effective_dir(Some("/wt"), "/proj"), "/wt");
        assert_eq!(effective_dir(None, "/proj"), "/proj");
    }

    #[tokio::test]
    async fn attaching_without_a_branch_name_persists_a_cleared_branch() {
        let session = Arc::new(FakeSession::spawned());
        let cell = cell_with(session);
        let deps = FakeDeps::with_project(cell.clone(), test_project());
        let manager = ChatConfigManager::new(deps);

        manager
            .attach_worktree("c1", "/new/wt", None)
            .await
            .unwrap();

        let updates = manager.deps.updates.lock().unwrap();
        assert_eq!(
            updates.as_slice(),
            &[ChatFieldUpdate {
                worktree_path: Some(Some("/new/wt".to_string())),
                branch_name: Some(None),
                ..Default::default()
            }]
        );
    }

    #[tokio::test]
    async fn attach_worktree_fires_on_binding_changed_exactly_once_with_the_new_path() {
        let session = Arc::new(FakeSession::spawned());
        let cell = cell_with(session);
        let deps = FakeDeps::with_project(cell.clone(), test_project());
        let manager = ChatConfigManager::new(deps);

        manager
            .attach_worktree("c1", "/new/wt", Some("feat"))
            .await
            .unwrap();

        let binding_changed = manager.deps.binding_changed.lock().unwrap();
        assert_eq!(binding_changed.as_slice(), &[Some("/new/wt".to_string())]);
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
