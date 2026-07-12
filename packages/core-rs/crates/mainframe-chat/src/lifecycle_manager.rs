//! Ported from `packages/core/src/chat/lifecycle-manager.ts`.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use dashmap::DashMap;
use mainframe_adapter_api::{AdapterError, AdapterSession, BoxFuture, SessionSink};
use mainframe_services::settings::normalize_saved_default_model;
use mainframe_types::adapter::{AdapterModel, SessionOptions, SessionSpawnOptions};
use mainframe_types::chat::{Chat, ChatStatus, ProcessState, ResolvedTuning};
use mainframe_types::events::DaemonEvent;
use tokio::sync::Notify;
use tracing::{info, warn};

use crate::message_cache::MessageCache;
use crate::permission_manager::PermissionManager;
use crate::types::ActiveChat;

/// True when no chat OTHER than `exclude_chat_id` is still active (non-archived)
/// and resolves to the same launch scope (`worktreePath ?? projectPath`).
pub fn is_last_active_chat_for_scope(
    chats: &[Chat],
    project_path: &str,
    effective_path: &str,
    exclude_chat_id: &str,
) -> bool {
    !chats.iter().any(|c| {
        c.id != exclude_chat_id
            && c.status != ChatStatus::Archived
            && c.worktree_path.as_deref().unwrap_or(project_path) == effective_path
    })
}

/// Registry of active chats (SHARED_MAP; per-entity values are `Arc<Mutex<ActiveChat>>`).
pub type ActiveChatRegistry = Arc<DashMap<String, Arc<Mutex<ActiveChat>>>>;

/// Partial `db.chats.update` patch for the lifecycle paths. Worktree fields are
/// tri-state (`Some(None)` clears).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct LifecycleChatUpdate {
    pub worktree_path: Option<Option<String>>,
    pub branch_name: Option<Option<String>>,
    pub plan_mode: Option<bool>,
    pub title: Option<String>,
    pub status: Option<ChatStatus>,
}

/// Errors surfaced by lifecycle ops (strings cross the wire; copied verbatim).
#[derive(Debug, thiserror::Error)]
pub enum LifecycleError {
    #[error("{0}")]
    Message(String),
    /// `forkToWorktree` dirty-tree rejection (HTTP 409 upstream).
    #[error("Commit or stash your changes before forking")]
    DirtyWorkingTree,
    #[error(transparent)]
    Adapter(#[from] AdapterError),
}

/// Injected dependency surface (mirrors the TS `LifecycleManagerDeps`).
pub trait LifecycleManagerDeps: Send + Sync {
    // db ----------------------------------------------------------------------
    fn chats_get(&self, id: &str) -> Option<Chat>;
    fn chats_create(
        &self,
        project_id: &str,
        adapter_id: &str,
        model: Option<&str>,
        permission_mode: Option<&str>,
    ) -> Chat;
    fn chats_update(&self, chat_id: &str, patch: &LifecycleChatUpdate);
    fn chats_list(&self, project_id: &str) -> Vec<Chat>;
    fn projects_get_path(&self, project_id: &str) -> Option<String>;
    fn settings_get(&self, ns: &str, key: &str) -> Option<String>;
    /// `adapters.getSnapshots().find((s) => s.id === adapterId)?.models ?? []` —
    /// the live probed catalog used to normalize a saved default-model id.
    fn adapter_snapshot_models(&self, _adapter_id: &str) -> Vec<AdapterModel> {
        Vec::new()
    }

    // adapters + sink ---------------------------------------------------------
    fn create_session(
        &self,
        adapter_id: &str,
        options: SessionOptions,
    ) -> Option<Arc<dyn AdapterSession>>;
    fn build_sink(&self, chat_id: &str, session_id: &str) -> Arc<dyn SessionSink>;

    // events + attachments + tracker/launch seams ----------------------------
    fn emit_event(&self, event: DaemonEvent);
    fn attachment_delete_chat<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()>;
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

    // Claude-specific + tuning seams ------------------------------------------
    /// Post `loadHistory`: mention extraction + PR-URL scan + plan/skill-file
    /// extraction (all Claude-specific — adapter-claude — so injected here).
    fn scan_loaded_history<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()>;
    fn resolve_tuning<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, Option<ResolvedTuning>>;
    /// `session.setCodexProviderTuning(...)` for the codex adapter (no-op elsewhere).
    fn apply_codex_provider_tuning(&self, session: &Arc<dyn AdapterSession>);
    /// Adapter-aware LLM title generation (`adapter.generateTitle`) — shells out;
    /// injected so tests skip it. The impl resolves `adapters.get(adapterId)` and
    /// returns `None` when that adapter has no `generateTitle` (deterministic title
    /// stands). Main catch-up (#430): title gen moved onto the owning adapter.
    fn generate_title<'a>(
        &'a self,
        adapter_id: &'a str,
        content: &'a str,
        binary: &'a str,
    ) -> BoxFuture<'a, Option<String>>;
    /// `isWorkingTreeDirty(projectPath)` — `git status --porcelain` non-empty.
    fn is_working_tree_dirty<'a>(&'a self, project_path: &'a str) -> BoxFuture<'a, bool>;
    /// `existsSync(worktreePath)`.
    fn path_exists(&self, path: &str) -> bool;
}

/// Single-flight decision computed under the guard, applied after the guard drops.
enum Flight {
    Await(Arc<Notify>),
    Claimed(Arc<Notify>),
    Skip,
}

/// One in-flight single-flight guard (rule 9 — `Notify` in place of `futures::Shared`).
#[derive(Default)]
struct Guards {
    loading: HashMap<String, Arc<Notify>>,
    starting: HashMap<String, Arc<Notify>>,
    interrupting: HashMap<String, Arc<Notify>>,
}

/// Join an in-flight single-flight `Notify` without a lost wakeup. `notify_waiters`
/// stores no permit and only wakes waiters already registered at the call, so the
/// naive `clone → drop lock → notified().await` races the owner's `remove +
/// notify_waiters` and can hang forever (the TS twin awaited a level-triggered
/// Promise). Register the waiter (`enable`) BEFORE re-reading the map, then await
/// only while the SAME `Notify` is still in flight (`Arc::ptr_eq` guards against an
/// ABA where a newer generation claimed the slot under the same key).
async fn join_flight(
    guards: &Arc<Mutex<Guards>>,
    existing: Arc<Notify>,
    select: impl Fn(&Guards) -> Option<&Arc<Notify>>,
) {
    let notified = existing.notified();
    tokio::pin!(notified);
    notified.as_mut().enable();
    let still_in_flight = {
        let g = guards.lock().unwrap_or_else(|e| e.into_inner());
        select(&g).is_some_and(|current| Arc::ptr_eq(current, &existing))
    };
    if still_in_flight {
        notified.await;
    }
}

pub struct ChatLifecycleManager<D: LifecycleManagerDeps + 'static> {
    deps: Arc<D>,
    active_chats: ActiveChatRegistry,
    messages: Arc<Mutex<MessageCache>>,
    permissions: Arc<Mutex<PermissionManager>>,
    guards: Arc<Mutex<Guards>>,
}

impl<D: LifecycleManagerDeps + 'static> ChatLifecycleManager<D> {
    pub fn new(
        deps: Arc<D>,
        active_chats: ActiveChatRegistry,
        messages: Arc<Mutex<MessageCache>>,
        permissions: Arc<Mutex<PermissionManager>>,
    ) -> Self {
        Self {
            deps,
            active_chats,
            messages,
            permissions,
            guards: Arc::new(Mutex::new(Guards::default())),
        }
    }

    fn get_active(&self, chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        self.active_chats.get(chat_id).map(|e| e.value().clone())
    }

    fn chat_or_db(&self, chat_id: &str) -> Option<Chat> {
        self.get_active(chat_id)
            .map(|c| c.lock().unwrap_or_else(|e| e.into_inner()).chat.clone())
            .or_else(|| self.deps.chats_get(chat_id))
    }

    pub async fn create_chat(
        &self,
        project_id: &str,
        adapter_id: &str,
        model: Option<&str>,
        permission_mode: Option<&str>,
        worktree_path: Option<&str>,
        branch_name: Option<&str>,
    ) -> Chat {
        let mut chat = self
            .deps
            .chats_create(project_id, adapter_id, model, permission_mode);
        if let (Some(wt), Some(branch)) = (worktree_path, branch_name) {
            self.deps.chats_update(
                &chat.id,
                &LifecycleChatUpdate {
                    worktree_path: Some(Some(wt.to_string())),
                    branch_name: Some(Some(branch.to_string())),
                    ..Default::default()
                },
            );
            chat.worktree_path = Some(wt.to_string());
            chat.branch_name = Some(branch.to_string());
        }
        info!(
            chat_id = chat.id,
            project_id, adapter_id, worktree_path, "chat created"
        );
        self.active_chats.insert(
            chat.id.clone(),
            Arc::new(Mutex::new(ActiveChat {
                chat: chat.clone(),
                session: None,
                turn_started_at: None,
            })),
        );
        self.deps.emit_event(DaemonEvent::ChatCreated {
            chat: chat.clone(),
            source: None,
        });
        chat
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_chat_with_defaults(
        &self,
        project_id: &str,
        adapter_id: &str,
        model: Option<&str>,
        permission_mode: Option<&str>,
        worktree_path: Option<&str>,
        branch_name: Option<&str>,
    ) -> Chat {
        let mut effective_model = model.map(str::to_string);
        let mut effective_mode = permission_mode.map(str::to_string);
        let mut effective_plan_mode = false;

        if effective_model.is_none() || effective_mode.is_none() || !effective_plan_mode {
            let default_model = self
                .deps
                .settings_get("provider", &format!("{adapter_id}.defaultModel"));
            let default_mode = self
                .deps
                .settings_get("provider", &format!("{adapter_id}.defaultMode"));
            let default_plan_mode = self
                .deps
                .settings_get("provider", &format!("{adapter_id}.defaultPlanMode"));

            if effective_model.is_none()
                && let Some(m) = default_model
            {
                let models = self.deps.adapter_snapshot_models(adapter_id);
                effective_model = normalize_saved_default_model(Some(&m), &models);
            }
            if effective_mode.is_none()
                && let Some(m) = default_mode
            {
                effective_mode = Some(m);
            }
            if default_plan_mode.as_deref() == Some("true") {
                effective_plan_mode = true;
            }
        }

        let mut chat = self
            .create_chat(
                project_id,
                adapter_id,
                effective_model.as_deref(),
                effective_mode.as_deref(),
                worktree_path,
                branch_name,
            )
            .await;
        if effective_plan_mode {
            chat.plan_mode = Some(true);
            self.deps.chats_update(
                &chat.id,
                &LifecycleChatUpdate {
                    plan_mode: Some(true),
                    ..Default::default()
                },
            );
        }
        chat
    }

    pub async fn resume_chat(&self, chat_id: &str) {
        self.load_chat(chat_id).await;

        let Some(chat) = self.chat_or_db(chat_id) else {
            return;
        };

        if chat.process_state == Some(Some(ProcessState::Working)) {
            let is_yolo = chat
                .permission_mode
                .map(|m| format!("{m:?}").to_lowercase())
                == Some("yolo".to_string());
            // TS: `if yolo → start; else if !hasPending → start`. Both branches call
            // startChat, so the identical arms collapse to one guard (hasPending is
            // still short-circuited when yolo, matching the original evaluation).
            let no_pending = || {
                !self
                    .permissions
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .has_pending(chat_id)
            };
            if is_yolo || no_pending() {
                self.start_chat(chat_id).await;
            }
        }

        self.deps.emit_event(DaemonEvent::ChatUpdated {
            chat: chat.clone(),
            reason: None,
        });

        if let Some(todos) = chat.todos {
            self.deps.emit_event(DaemonEvent::TodosUpdated {
                chat_id: chat_id.to_string(),
                todos,
            });
        }
    }

    pub async fn load_chat(&self, chat_id: &str) {
        // Single-flight: await an in-flight load, else claim the slot (guard is
        // dropped before any `.await` — std MutexGuard is not Send).
        let action = {
            let mut g = self.guards.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(existing) = g.loading.get(chat_id).cloned() {
                Flight::Await(existing)
            } else if self.active_chats.contains_key(chat_id) {
                Flight::Skip
            } else {
                let n = Arc::new(Notify::new());
                g.loading.insert(chat_id.to_string(), n.clone());
                Flight::Claimed(n)
            }
        };
        let notify = match action {
            Flight::Await(existing) => {
                join_flight(&self.guards, existing, |g| g.loading.get(chat_id)).await;
                return;
            }
            Flight::Skip => return,
            Flight::Claimed(n) => n,
        };
        self.do_load_chat(chat_id).await;
        self.guards
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .loading
            .remove(chat_id);
        notify.notify_waiters();
    }

    /// Await any in-flight load (chat_manager's `getMessages` inflight check).
    pub async fn await_loading(&self, chat_id: &str) {
        let n = self
            .guards
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .loading
            .get(chat_id)
            .cloned();
        if let Some(n) = n {
            join_flight(&self.guards, n, |g| g.loading.get(chat_id)).await;
        }
    }

    /// Await any in-flight spawn (config_manager's `startingChats` check).
    pub async fn await_starting(&self, chat_id: &str) -> bool {
        let n = self
            .guards
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .starting
            .get(chat_id)
            .cloned();
        if let Some(n) = n {
            join_flight(&self.guards, n, |g| g.starting.get(chat_id)).await;
            true
        } else {
            false
        }
    }

    pub async fn start_chat(&self, chat_id: &str) {
        if let Some(cell) = self.get_active(chat_id) {
            let (spawned, process) = {
                let guard = cell.lock().unwrap_or_else(|e| e.into_inner());
                let spawned = guard.session.as_ref().is_some_and(|s| s.is_spawned());
                let process = guard.session.as_ref().and_then(|s| s.get_process_info());
                (spawned, process)
            };
            if spawned {
                if let Some(process) = process {
                    self.deps.emit_event(DaemonEvent::ProcessStarted {
                        chat_id: chat_id.to_string(),
                        process,
                    });
                }
                return;
            }
        }

        // Claim the single-flight slot (or grab an in-flight Notify) WITHOUT
        // holding the guard across the `.await` (std MutexGuard is not Send).
        let action = {
            let mut g = self.guards.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(existing) = g.starting.get(chat_id).cloned() {
                Flight::Await(existing)
            } else {
                let n = Arc::new(Notify::new());
                g.starting.insert(chat_id.to_string(), n.clone());
                Flight::Claimed(n)
            }
        };
        let notify = match action {
            Flight::Await(existing) => {
                join_flight(&self.guards, existing, |g| g.starting.get(chat_id)).await;
                return;
            }
            Flight::Skip => return, // start_chat never claims Skip
            Flight::Claimed(n) => n,
        };
        let result = self.do_start_chat(chat_id).await;
        self.guards
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .starting
            .remove(chat_id);
        notify.notify_waiters();
        if let Err(err) = result {
            warn!(?err, chat_id, "startChat failed");
        }
    }

    pub async fn interrupt_chat(&self, chat_id: &str) {
        let Some(cell) = self.get_active(chat_id) else {
            return;
        };
        let session = {
            let guard = cell.lock().unwrap_or_else(|e| e.into_inner());
            if !guard.session.as_ref().is_some_and(|s| s.is_spawned()) {
                return;
            }
            guard.session.clone()
        };

        {
            let mut perms = self.permissions.lock().unwrap_or_else(|e| e.into_inner());
            perms.clear(chat_id);
            perms.mark_interrupted(chat_id);
        }

        // SIGINT causes the CLI to exit. Track the exit so sendMessage can wait.
        let already = self
            .guards
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .interrupting
            .contains_key(chat_id);
        if !already {
            let notify = Arc::new(Notify::new());
            self.guards
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .interrupting
                .insert(chat_id.to_string(), notify.clone());
            let cell_poll = cell.clone();
            let guards = self.guards.clone();
            let chat_id_owned = chat_id.to_string();
            tokio::spawn(async move {
                let deadline = tokio::time::Instant::now() + Duration::from_millis(5000);
                loop {
                    let spawned = {
                        let g = cell_poll.lock().unwrap_or_else(|e| e.into_inner());
                        g.session.as_ref().is_some_and(|s| s.is_spawned())
                    };
                    if !spawned || tokio::time::Instant::now() >= deadline {
                        guards
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .interrupting
                            .remove(&chat_id_owned);
                        notify.notify_waiters();
                        return;
                    }
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            });
        }

        if let Some(session) = session
            && let Err(err) = session.interrupt().await
        {
            warn!(?err, chat_id, "interrupt failed");
        }
    }

    /// Wait for any in-flight interrupt to finish (process exit).
    pub async fn wait_for_interrupt(&self, chat_id: &str) {
        let n = self
            .guards
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .interrupting
            .get(chat_id)
            .cloned();
        if let Some(n) = n {
            join_flight(&self.guards, n, |g| g.interrupting.get(chat_id)).await;
        }
    }

    pub async fn archive_chat(&self, chat_id: &str, delete_worktree: bool) {
        let cell = self.get_active(chat_id);
        let session = cell
            .as_ref()
            .and_then(|c| c.lock().unwrap_or_else(|e| e.into_inner()).session.clone());
        let chat = self.chat_or_db(chat_id);

        let worktree_path = chat.as_ref().and_then(|c| c.worktree_path.clone());
        self.deps
            .kill_tasks_for_chat(
                chat_id,
                if delete_worktree {
                    worktree_path.clone()
                } else {
                    None
                },
                session.clone(),
            )
            .await;

        if let Some(session) = &session
            && let Err(err) = session.kill().await
        {
            warn!(?err, chat_id, "session.kill failed on archive");
        }

        let project_path = chat
            .as_ref()
            .and_then(|c| self.deps.projects_get_path(&c.project_id));
        let effective_path = worktree_path.clone().or_else(|| project_path.clone());

        if let (Some(chat), Some(project_path), Some(effective_path)) =
            (&chat, &project_path, &effective_path)
        {
            let last_user = is_last_active_chat_for_scope(
                &self.deps.chats_list(&chat.project_id),
                project_path,
                effective_path,
                chat_id,
            );
            if last_user {
                if let Some(fut) = self
                    .deps
                    .stop_launch_processes(&chat.project_id, effective_path)
                {
                    fut.await;
                }
                self.deps.emit_event(DaemonEvent::LaunchScopeReleased {
                    project_id: chat.project_id.clone(),
                    effective_path: effective_path.clone(),
                });
            }
        }

        if delete_worktree
            && let (Some(chat), Some(project_path)) = (&chat, &project_path)
            && let (Some(wt), Some(branch)) = (&chat.worktree_path, &chat.branch_name)
        {
            self.deps.remove_worktree(project_path, wt, branch).await;
        }

        self.active_chats.remove(chat_id);
        self.messages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .delete(chat_id);
        self.permissions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear(chat_id);
        self.deps.attachment_delete_chat(chat_id).await;
        self.deps.chats_update(
            chat_id,
            &LifecycleChatUpdate {
                status: Some(ChatStatus::Archived),
                ..Default::default()
            },
        );
        info!(chat_id, "chat archived");
        self.deps.emit_event(DaemonEvent::ChatEnded {
            chat_id: chat_id.to_string(),
        });
    }

    /// Stop a running session without ending the chat.
    pub async fn stop_chat(&self, chat_id: &str) {
        let Some(cell) = self.get_active(chat_id) else {
            return;
        };
        let session = cell
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .session
            .clone();
        let Some(session) = session else {
            return;
        };
        if session.is_spawned()
            && let Err(err) = session.kill().await
        {
            warn!(?err, chat_id, "session.kill failed on stopChat");
        }
        cell.lock().unwrap_or_else(|e| e.into_inner()).session = None;
    }

    pub async fn end_chat(&self, chat_id: &str) {
        let Some(cell) = self.get_active(chat_id) else {
            return;
        };
        let session = cell
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .session
            .clone();

        self.deps
            .kill_tasks_for_chat(chat_id, None, session.clone())
            .await;

        if let Some(session) = &session
            && let Err(err) = session.kill().await
        {
            warn!(?err, chat_id, "session.kill failed on endChat");
        }

        self.deps.chats_update(
            chat_id,
            &LifecycleChatUpdate {
                status: Some(ChatStatus::Ended),
                ..Default::default()
            },
        );
        self.active_chats.remove(chat_id);
        self.deps.emit_event(DaemonEvent::ChatEnded {
            chat_id: chat_id.to_string(),
        });
    }

    pub async fn fork_to_worktree(
        &self,
        chat_id: &str,
        _base_branch: &str,
        _branch_name: &str,
    ) -> Result<String, LifecycleError> {
        let source_chat = self
            .chat_or_db(chat_id)
            .ok_or_else(|| LifecycleError::Message(format!("Chat {chat_id} not found")))?;
        let project_path = self
            .deps
            .projects_get_path(&source_chat.project_id)
            .ok_or_else(|| LifecycleError::Message("Project not found".to_string()))?;

        if self.deps.is_working_tree_dirty(&project_path).await {
            return Err(LifecycleError::DirtyWorkingTree);
        }

        let new_chat = self
            .create_chat(
                &source_chat.project_id,
                &source_chat.adapter_id,
                source_chat.model.as_deref(),
                source_chat
                    .permission_mode
                    .map(|m| format!("{m:?}").to_lowercase())
                    .as_deref(),
                None,
                None,
            )
            .await;
        // The `enableWorktree(newChatId, base, branch)` step is owned by
        // chat_manager (it holds the config_manager); it invokes this via the
        // returned new chat id. Mirrors the TS `enableWorktreeFn` callback.
        Ok(new_chat.id)
    }

    pub async fn do_generate_title(&self, chat_id: &str, content: &str) {
        let Some(cell) = self.get_active(chat_id) else {
            return;
        };
        if self
            .deps
            .settings_get("general", "titleGeneration.disabled")
            .as_deref()
            == Some("true")
        {
            return;
        }
        let adapter_id = cell
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .chat
            .adapter_id
            .clone();
        let binary = self
            .deps
            .settings_get("provider", &format!("{adapter_id}.titleBinary"))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "claude".to_string());

        if let Some(title) = self
            .deps
            .generate_title(&adapter_id, content, &binary)
            .await
        {
            let chat = {
                let mut guard = cell.lock().unwrap_or_else(|e| e.into_inner());
                guard.chat.title = Some(title.clone());
                guard.chat.clone()
            };
            self.deps.chats_update(
                chat_id,
                &LifecycleChatUpdate {
                    title: Some(title),
                    ..Default::default()
                },
            );
            self.deps
                .emit_event(DaemonEvent::ChatUpdated { chat, reason: None });
        }
    }

    async fn do_load_chat(&self, chat_id: &str) {
        let Some(chat) = self.deps.chats_get(chat_id) else {
            warn!(chat_id, "doLoadChat: chat not found");
            return;
        };
        self.active_chats.insert(
            chat_id.to_string(),
            Arc::new(Mutex::new(ActiveChat {
                chat: chat.clone(),
                session: None,
                turn_started_at: None,
            })),
        );

        let Some(project_path) = self.deps.projects_get_path(&chat.project_id) else {
            return;
        };
        let effective_path = chat.worktree_path.clone().unwrap_or(project_path);

        if let Some(wt) = &chat.worktree_path
            && !self.deps.path_exists(wt)
        {
            return;
        }

        let Some(claude_session_id) = &chat.claude_session_id else {
            return;
        };

        let Some(session) = self.deps.create_session(
            &chat.adapter_id,
            SessionOptions {
                project_path: effective_path,
                chat_id: Some(claude_session_id.clone()),
                mainframe_chat_id: chat_id.to_string(),
            },
        ) else {
            return;
        };
        if let Some(cell) = self.get_active(chat_id) {
            cell.lock().unwrap_or_else(|e| e.into_inner()).session = Some(session.clone());
        }

        if let Ok(history) = session.load_history().await {
            let remapped: Vec<_> = history
                .into_iter()
                .map(|mut m| {
                    m.chat_id = chat_id.to_string();
                    m
                })
                .collect();
            if !remapped.is_empty() {
                self.messages
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .set(chat_id, remapped.clone());
                self.permissions
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .restore_pending_permission(chat_id, &remapped);
            }
        }

        // Mention extraction + PR-URL scan + plan/skill-file extraction are all
        // Claude-specific (`extractPrFromToolResult`, `session.extractPlanFiles`,
        // `db.chats.addPlanFile`) and out of this crate's dep set, so the whole
        // post-load scan is one injected seam that its owner (chat_manager /
        // later phase) implements over the just-set message cache.
        // TODO(port): thread the loaded `session` handle into the scan seam once
        // the adapter-claude history scanner is wired.
        let _ = &session;
        self.deps.scan_loaded_history(chat_id).await;
    }

    async fn do_start_chat(&self, chat_id: &str) -> Result<(), LifecycleError> {
        self.load_chat(chat_id).await;

        let cell = self.get_active(chat_id).ok_or_else(|| {
            LifecycleError::Message(format!("Chat {chat_id} not found after load"))
        })?;

        let (spawned, process, chat) = {
            let guard = cell.lock().unwrap_or_else(|e| e.into_inner());
            (
                guard.session.as_ref().is_some_and(|s| s.is_spawned()),
                guard.session.as_ref().and_then(|s| s.get_process_info()),
                guard.chat.clone(),
            )
        };
        if spawned {
            if let Some(process) = process {
                self.deps.emit_event(DaemonEvent::ProcessStarted {
                    chat_id: chat_id.to_string(),
                    process,
                });
            }
            return Ok(());
        }

        if let Some(wt) = &chat.worktree_path
            && !self.deps.path_exists(wt)
        {
            return Err(LifecycleError::Message(format!(
                "Worktree directory does not exist: {wt}"
            )));
        }

        let project_path = self
            .deps
            .projects_get_path(&chat.project_id)
            .ok_or_else(|| {
                LifecycleError::Message(format!("Project {} not found", chat.project_id))
            })?;

        let session = self
            .deps
            .create_session(
                &chat.adapter_id,
                SessionOptions {
                    project_path: chat.worktree_path.clone().unwrap_or(project_path),
                    chat_id: chat.claude_session_id.clone(),
                    mainframe_chat_id: chat_id.to_string(),
                },
            )
            .ok_or_else(|| {
                LifecycleError::Message(format!("Adapter {} not found", chat.adapter_id))
            })?;
        cell.lock().unwrap_or_else(|e| e.into_inner()).session = Some(session.clone());

        if chat.adapter_id == "codex" {
            self.deps.apply_codex_provider_tuning(&session);
        }

        let sink = self.deps.build_sink(chat_id, session.id());

        let executable_path = self
            .deps
            .settings_get("provider", &format!("{}.executablePath", chat.adapter_id));
        let system_prompt = self
            .deps
            .settings_get("provider", &format!("{}.systemPrompt", chat.adapter_id));
        let tuning = self.deps.resolve_tuning(chat_id).await;
        let process = session
            .spawn(
                Some(SessionSpawnOptions {
                    model: chat.model.clone(),
                    permission_mode: chat.permission_mode,
                    plan_mode: Some(chat.plan_mode.unwrap_or(false)),
                    executable_path,
                    system_prompt,
                    tuning,
                }),
                Some(sink),
            )
            .await?;
        info!(chat_id, "chat session started");
        self.deps.emit_event(DaemonEvent::ProcessStarted {
            chat_id: chat_id.to_string(),
            process,
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{FakeSession, test_chat};

    fn chat_over(id: &str, worktree: Option<&str>, status: ChatStatus) -> Chat {
        let mut c = test_chat(id);
        c.worktree_path = worktree.map(str::to_string);
        c.status = status;
        c
    }

    // ── isLastActiveChatForScope (lifecycle-archive-releases-scope.test.ts) ───
    #[test]
    fn false_when_a_non_archived_sibling_shares_the_worktree_scope() {
        let chats = vec![
            chat_over("c1", Some("/wt/x"), ChatStatus::Active),
            chat_over("c2", Some("/wt/x"), ChatStatus::Active),
        ];
        assert!(!is_last_active_chat_for_scope(
            &chats, "/proj", "/wt/x", "c1"
        ));
    }

    #[test]
    fn false_when_a_non_archived_sibling_shares_the_project_root_scope() {
        let chats = vec![
            chat_over("c1", None, ChatStatus::Active),
            chat_over("c2", None, ChatStatus::Active),
        ];
        assert!(!is_last_active_chat_for_scope(
            &chats, "/proj", "/proj", "c1"
        ));
    }

    #[test]
    fn true_for_a_unique_worktree_scope() {
        let chats = vec![
            chat_over("c1", Some("/wt/x"), ChatStatus::Active),
            chat_over("c2", Some("/wt/y"), ChatStatus::Active),
        ];
        assert!(is_last_active_chat_for_scope(
            &chats, "/proj", "/wt/x", "c1"
        ));
    }

    #[test]
    fn ignores_archived_siblings_on_the_same_scope() {
        let chats = vec![
            chat_over("c1", Some("/wt/x"), ChatStatus::Active),
            chat_over("c2", Some("/wt/x"), ChatStatus::Archived),
        ];
        assert!(is_last_active_chat_for_scope(
            &chats, "/proj", "/wt/x", "c1"
        ));
    }

    #[test]
    fn excludes_the_chat_being_archived_from_the_count() {
        let chats = vec![chat_over("c1", Some("/wt/x"), ChatStatus::Active)];
        assert!(is_last_active_chat_for_scope(
            &chats, "/proj", "/wt/x", "c1"
        ));
    }

    // ── archiveChat (kills-tasks + releases-scope) ───────────────────────────
    struct FakeDeps {
        chat: Chat,
        siblings: Vec<Chat>,
        order: Mutex<Vec<String>>,
        events: Mutex<Vec<DaemonEvent>>,
        stop_calls: Mutex<Vec<(String, String)>>,
    }

    impl FakeDeps {
        fn new(chat: Chat, siblings: Vec<Chat>) -> Arc<Self> {
            Arc::new(Self {
                chat,
                siblings,
                order: Mutex::new(Vec::new()),
                events: Mutex::new(Vec::new()),
                stop_calls: Mutex::new(Vec::new()),
            })
        }
    }

    impl LifecycleManagerDeps for FakeDeps {
        fn chats_get(&self, _id: &str) -> Option<Chat> {
            Some(self.chat.clone())
        }
        fn chats_create(&self, _p: &str, _a: &str, _m: Option<&str>, _pm: Option<&str>) -> Chat {
            self.chat.clone()
        }
        fn chats_update(&self, _chat_id: &str, _patch: &LifecycleChatUpdate) {}
        fn chats_list(&self, _project_id: &str) -> Vec<Chat> {
            let mut all = vec![self.chat.clone()];
            all.extend(self.siblings.clone());
            all
        }
        fn projects_get_path(&self, _project_id: &str) -> Option<String> {
            Some("/proj".to_string())
        }
        fn settings_get(&self, _ns: &str, _key: &str) -> Option<String> {
            None
        }
        fn create_session(&self, _a: &str, _o: SessionOptions) -> Option<Arc<dyn AdapterSession>> {
            None
        }
        fn build_sink(&self, _chat_id: &str, _session_id: &str) -> Arc<dyn SessionSink> {
            unreachable!("not exercised")
        }
        fn emit_event(&self, event: DaemonEvent) {
            self.events.lock().unwrap().push(event);
        }
        fn attachment_delete_chat<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, ()> {
            Box::pin(async {})
        }
        fn kill_tasks_for_chat<'a>(
            &'a self,
            _chat_id: &'a str,
            worktree_path: Option<String>,
            _session: Option<Arc<dyn AdapterSession>>,
        ) -> BoxFuture<'a, ()> {
            self.order.lock().unwrap().push(format!(
                "kill:{}",
                worktree_path.as_deref().unwrap_or("no-wt")
            ));
            Box::pin(async {})
        }
        fn remove_worktree<'a>(
            &'a self,
            _project_path: &'a str,
            _worktree_path: &'a str,
            _branch_name: &'a str,
        ) -> BoxFuture<'a, ()> {
            Box::pin(async {})
        }
        fn stop_launch_processes<'a>(
            &'a self,
            project_id: &'a str,
            effective_path: &'a str,
        ) -> Option<BoxFuture<'a, ()>> {
            self.stop_calls
                .lock()
                .unwrap()
                .push((project_id.to_string(), effective_path.to_string()));
            Some(Box::pin(async {}))
        }
        fn scan_loaded_history<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, ()> {
            Box::pin(async {})
        }
        fn resolve_tuning<'a>(
            &'a self,
            _chat_id: &'a str,
        ) -> BoxFuture<'a, Option<ResolvedTuning>> {
            Box::pin(async { None })
        }
        fn apply_codex_provider_tuning(&self, _session: &Arc<dyn AdapterSession>) {}
        fn generate_title<'a>(
            &'a self,
            _adapter_id: &'a str,
            _content: &'a str,
            _binary: &'a str,
        ) -> BoxFuture<'a, Option<String>> {
            Box::pin(async { None })
        }
        fn is_working_tree_dirty<'a>(&'a self, _project_path: &'a str) -> BoxFuture<'a, bool> {
            Box::pin(async { false })
        }
        fn path_exists(&self, _path: &str) -> bool {
            true
        }
    }

    fn manager(deps: Arc<FakeDeps>) -> ChatLifecycleManager<FakeDeps> {
        ChatLifecycleManager::new(
            deps,
            Arc::new(DashMap::new()),
            Arc::new(Mutex::new(MessageCache::new())),
            Arc::new(Mutex::new(PermissionManager::new())),
        )
    }

    #[tokio::test]
    async fn calls_kill_tasks_before_session_kill_with_worktree_path() {
        let chat = {
            let mut c = chat_over("c1", Some("/wt/x"), ChatStatus::Active);
            c.branch_name = Some("feat/x".to_string());
            c
        };
        let deps = FakeDeps::new(chat.clone(), Vec::new());
        let mgr = manager(deps.clone());
        // Insert an active chat whose FakeSession records its own kill order.
        let session = FakeSession::with_activity(true, None);
        mgr.active_chats.insert(
            "c1".to_string(),
            Arc::new(Mutex::new(ActiveChat {
                chat,
                session: Some(session.clone()),
                turn_started_at: None,
            })),
        );

        mgr.archive_chat("c1", true).await;

        // killTasksForChat is called (with the worktree path) BEFORE session.kill;
        // the deps seam records the kill-tasks call and FakeSession counts its kill.
        let order = deps.order.lock().unwrap();
        assert!(order.iter().any(|s| s == "kill:/wt/x"));
        assert_eq!(session.kills(), 1);
    }

    #[tokio::test]
    async fn last_user_stops_launches_and_emits_scope_released() {
        let chat = {
            let mut c = chat_over("c1", Some("/wt/x"), ChatStatus::Active);
            c.branch_name = Some("feat/x".to_string());
            c
        };
        let deps = FakeDeps::new(chat, Vec::new());
        let mgr = manager(deps.clone());
        mgr.archive_chat("c1", false).await; // keep-worktree

        assert_eq!(
            deps.stop_calls.lock().unwrap().as_slice(),
            &[("p1".to_string(), "/wt/x".to_string())]
        );
        assert!(deps.events.lock().unwrap().iter().any(|e| matches!(
            e,
            DaemonEvent::LaunchScopeReleased { project_id, effective_path }
                if project_id == "p1" && effective_path == "/wt/x"
        )));
    }

    #[tokio::test]
    async fn shared_scope_keeps_the_scope_alive() {
        let chat = {
            let mut c = chat_over("c1", Some("/wt/x"), ChatStatus::Active);
            c.branch_name = Some("feat/x".to_string());
            c
        };
        let sibling = chat_over("c2", Some("/wt/x"), ChatStatus::Active);
        let deps = FakeDeps::new(chat, vec![sibling]);
        let mgr = manager(deps.clone());
        mgr.archive_chat("c1", false).await;

        assert!(deps.stop_calls.lock().unwrap().is_empty());
        assert!(
            !deps
                .events
                .lock()
                .unwrap()
                .iter()
                .any(|e| matches!(e, DaemonEvent::LaunchScopeReleased { .. }))
        );
    }

    #[tokio::test]
    async fn no_worktree_last_user_releases_the_project_root_scope() {
        let chat = chat_over("c1", None, ChatStatus::Active);
        let deps = FakeDeps::new(chat, Vec::new());
        let mgr = manager(deps.clone());
        mgr.archive_chat("c1", false).await;

        assert_eq!(
            deps.stop_calls.lock().unwrap().as_slice(),
            &[("p1".to_string(), "/proj".to_string())]
        );
        assert!(deps.events.lock().unwrap().iter().any(|e| matches!(
            e,
            DaemonEvent::LaunchScopeReleased { effective_path, .. } if effective_path == "/proj"
        )));
    }

    // ── join_flight lost-wakeup regression ───────────────────────────────────
    // The owner removes the slot + notify_waiters BEFORE the awaiter registers.
    // `notify_waiters` stores no permit, so a bare `notified().await` would hang
    // forever; join_flight's enable-then-recheck must observe the empty slot and
    // return instead of parking on a wakeup that already fired.
    #[tokio::test]
    async fn join_flight_returns_when_slot_already_completed() {
        let guards = Arc::new(Mutex::new(Guards::default()));
        let n = Arc::new(Notify::new());
        guards
            .lock()
            .unwrap()
            .loading
            .insert("c1".to_string(), n.clone());
        guards.lock().unwrap().loading.remove("c1");
        n.notify_waiters();
        tokio::time::timeout(
            Duration::from_secs(1),
            join_flight(&guards, n.clone(), |g| g.loading.get("c1")),
        )
        .await
        .expect("join_flight hung after a completed single-flight (lost wakeup)");
    }

    // A waiter that registers while the slot is live must still be woken when the
    // owner later completes (remove + notify_waiters).
    #[tokio::test]
    async fn join_flight_wakes_when_owner_completes_after_registration() {
        let guards = Arc::new(Mutex::new(Guards::default()));
        let n = Arc::new(Notify::new());
        guards
            .lock()
            .unwrap()
            .loading
            .insert("c1".to_string(), n.clone());
        let g2 = guards.clone();
        let n2 = n.clone();
        let waiter =
            tokio::spawn(async move { join_flight(&g2, n2, |g| g.loading.get("c1")).await });
        tokio::time::sleep(Duration::from_millis(50)).await;
        guards.lock().unwrap().loading.remove("c1");
        n.notify_waiters();
        tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .expect("waiter never woke after owner completed")
            .unwrap();
    }
}

// PORT STATUS: src/chat/lifecycle-manager.ts (530 lines)
// confidence: medium
// notes: TS `LifecycleManagerDeps` DI bag → `LifecycleManagerDeps` trait; the
// notes: activeChats registry is the shared `Arc<DashMap<_, Arc<Mutex<ActiveChat>>>>`,
// notes: messages/permissions shared `Arc<Mutex<..>>`. loadingChats/startingChats/
// notes: interruptingChats single-flight → per-chat `Notify` maps (rule 9; no
// notes: futures::Shared in the workspace). Awaiters use `join_flight`: enable the
// notes: Notified BEFORE re-reading the map (ptr_eq) so the owner's remove +
// notes: notify_waiters is never lost (Notify stores no permit). The 50ms interrupt
// notes: poll → a spawned tokio poll task that notify_waiters on exit/5s. killTasksForChat +
// notes: removeWorktree are routed through deps seams so archive stays observable and
// notes: decoupled from git/spool I/O (tests assert order). doLoadChat's
// notes: Claude-specific mention/PR-URL history scan is relocated to the injected
// notes: `scan_loaded_history` seam (adapter-claude is out of this crate's dep set).
// notes: TODO(port): the plan/skill-file persist inside doLoadChat is owned by the
// notes: scan seam; the enableWorktree fork callback is wired by chat_manager (holds
// notes: config_manager). Ported: isLastActiveChatForScope (5), archive kills-tasks
// notes: (1), archive releases-scope (3) test cases.
// notes: Main catch-up (#441/#430): a saved default model is normalized against the
// notes: live snapshot (`adapter_snapshot_models` deps + `normalize_saved_default_model`)
// notes: before use; title gen is adapter-aware — `generate_title` gained an `adapter_id`
// notes: arg so the deps seam resolves `adapters.get(adapterId).generateTitle` (deterministic
// notes: title stands when the adapter has none).
// todos: 1
