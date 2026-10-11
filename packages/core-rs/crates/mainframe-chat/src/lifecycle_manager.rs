use mainframe_types::sync::LockExt as _;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use mainframe_adapter_api::AdapterError;
use mainframe_runtime::sync::{FlightClaim, FlightWaiter, SingleFlight};
use mainframe_services::settings::{normalize_saved_default_model, read_setting};
use mainframe_types::adapter::{SessionOptions, SessionSpawnOptions};
use mainframe_types::chat::{Chat, ChatMessage, ChatStatus, NewChat, ProcessState};
use mainframe_types::chat_patch::ChatPatch;
use mainframe_types::events::DaemonEvent;
use mainframe_types::http_status::{HttpStatus, NotFound, StatusKind};
use mainframe_types::settings::ExecutionMode;
use mainframe_types::time::now_iso8601;
use tracing::{debug, info, warn};

use crate::chat_cwd::chat_cwd;
use crate::chat_manager::ChatShared;
use crate::chat_surface::{self, ChatSurface, ChatSurfaceEvent};
use crate::event_handler::EventHandler;
use crate::no_persistence;
use crate::orchestration_hooks::OrchestrationSlot;
use crate::title_generator::resolve_title_binary;
use crate::types::ActiveChat;
use crate::worktree_offer::WorktreeOfferRegistry;

mod spawn_prep;

/// True when no chat OTHER than `exclude_chat_id` is still active (non-archived)
/// and resolves to the same launch scope (`worktreePath ?? projectPath`).
pub(crate) fn is_last_active_chat_for_scope(
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

use mainframe_types::time::now_ms;

/// Errors surfaced by lifecycle ops (strings cross the wire; copied verbatim).
#[derive(Debug, thiserror::Error)]
pub enum LifecycleError {
    #[error(transparent)]
    Store(#[from] mainframe_types::seam_error::SeamError),
    /// The chat, its project or its adapter is gone.
    #[error(transparent)]
    NotFound(#[from] NotFound),
    /// `load_chat` ran but left no active cell behind.
    #[error("Chat {0} not found after load")]
    NotLoaded(String),
    #[error("Worktree directory does not exist: {0}")]
    WorktreeMissing(String),
    #[error("Project directory does not exist or is not accessible: {0}")]
    ProjectDirMissing(String),
    /// `forkToWorktree` dirty-tree rejection (HTTP 409 upstream).
    #[error("Commit or stash your changes before forking")]
    DirtyWorkingTree,
    #[error(transparent)]
    Adapter(#[from] AdapterError),
}

impl HttpStatus for LifecycleError {
    fn status_kind(&self) -> StatusKind {
        match self {
            Self::Store(_) => StatusKind::Internal,
            Self::NotFound(_) => StatusKind::NotFound,
            Self::WorktreeMissing(_) | Self::ProjectDirMissing(_) | Self::DirtyWorkingTree => {
                StatusKind::Conflict
            }
            Self::NotLoaded(_) | Self::Adapter(_) => StatusKind::Internal,
        }
    }
}

/// Single-flight decision computed under the guard, applied after the guard drops.
enum Flight {
    Await(FlightWaiter),
    Claimed(FlightClaim),
    Skip,
}

/// Flight families share an outer lock for cross-operation exclusion.
#[derive(Default)]
struct Guards {
    loading: SingleFlight,
    starting: SingleFlight,
    interrupting: SingleFlight,
    /// In-flight idle offload per chat (`flight_claims.rs`). An offload claims
    /// this slot only when every other map below is empty for the chat and no
    /// send is registered;
    /// `load_chat`/`start_chat`/`get_messages`/`send_message` all wait it out
    /// before touching the registry or cache.
    offloading: SingleFlight,
    /// In-flight `send_message` calls per chat (`flight_claims.rs`).
    /// A count, not a flag: nothing in this codebase serializes concurrent
    /// sends to the same chat today, so offload must treat any of them as busy.
    sending: HashMap<String, usize>,
    /// In-flight on-disk transcript read behind `get_messages` per chat
    /// (`flight_claims.rs`) — single-flights a read that would otherwise race
    /// (two concurrent misses both hit disk).
    history: SingleFlight,
}

pub struct ChatLifecycleManager {
    shared: Arc<ChatShared>,
    /// Builds each spawned session's sink.
    event_handler: Arc<EventHandler>,
    /// Seeded with the worktrees a chat already knows when it activates.
    worktree_offers: Arc<WorktreeOfferRegistry>,
    guards: Arc<Mutex<Guards>>,
    /// Set post-construction via [`Self::set_chat_surface`] — mirrors
    /// `EventHandler`'s identical `OnceLock` pattern so a manager built with
    /// no surface attached (most unit tests) is a no-op, not a construction
    /// obligation.
    chat_surface: Arc<OnceLock<Arc<dyn ChatSurface>>>,
}

impl ChatLifecycleManager {
    pub(crate) fn new(
        shared: Arc<ChatShared>,
        event_handler: Arc<EventHandler>,
        worktree_offers: Arc<WorktreeOfferRegistry>,
    ) -> Self {
        Self {
            shared,
            event_handler,
            worktree_offers,
            guards: Arc::new(Mutex::new(Guards::default())),
            chat_surface: Arc::new(OnceLock::new()),
        }
    }

    /// First caller wins, matching `EventHandler::set_chat_surface` — a
    /// second call (e.g. a stray double-attach) is a harmless no-op.
    pub fn set_chat_surface(&self, surface: Arc<dyn ChatSurface>) {
        let _ = self.chat_surface.set(surface);
    }

    /// The orchestration hooks every spawn and teardown path consults — the
    /// chat manager's slot, so one attach reaches both spawns and the reads
    /// that show the agent outbox.
    pub fn orchestration(&self) -> &OrchestrationSlot {
        &self.shared.orchestration
    }

    fn get_active(&self, chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        self.shared
            .active_chats
            .get(chat_id)
            .map(|e| e.value().clone())
    }

    /// Bump `chat_id`'s in-memory "last used" clock to now, if its registry
    /// cell exists; a no-op otherwise. Called on every path that counts as use
    /// (`load_chat` — including its single-flight `Skip` branch, `start_chat`,
    /// send begin/end, history completion, and a claim-free config read) so an
    /// unspawned cell's idle clock (`idle_scanner::idle_since`) tracks real
    /// activity rather than the persisted chat's own age.
    pub(crate) fn touch(&self, chat_id: &str) {
        if let Some(cell) = self.get_active(chat_id) {
            cell.lock_recover().last_used_at = now_ms();
        }
    }

    fn chat_or_db(&self, chat_id: &str) -> Option<Chat> {
        self.get_active(chat_id)
            .map(|c| c.lock_recover().chat.clone())
            .or_else(|| storage_event!(self.shared, Some(chat_id); self.shared.deps.chats_get(chat_id), None))
    }

    pub async fn create_chat(
        &self,
        new_chat: NewChat,
        worktree_path: Option<&str>,
        branch_name: Option<&str>,
    ) -> Result<Chat, LifecycleError> {
        let project_id = new_chat.project_id.clone();
        let adapter_id = new_chat.adapter_id.clone();
        let mut chat = self.shared.deps.chats_create(&new_chat)?;
        if let (Some(wt), Some(branch)) = (worktree_path, branch_name) {
            self.shared.deps.chats_update(
                &chat.id,
                &ChatPatch {
                    worktree_path: Some(Some(wt.to_string())),
                    branch_name: Some(Some(branch.to_string())),
                    ..Default::default()
                },
            )?;
            chat.worktree_path = Some(wt.to_string());
            chat.branch_name = Some(branch.to_string());
        }
        info!(
            chat_id = chat.id,
            project_id = project_id.as_str(),
            adapter_id = adapter_id.as_str(),
            worktree_path,
            "chat created"
        );
        self.shared.active_chats.insert(
            chat.id.clone(),
            Arc::new(Mutex::new(ActiveChat::new(chat.clone(), None))),
        );
        self.shared.messages.lock_recover().pin(&chat.id);
        self.shared.emit(DaemonEvent::ChatCreated {
            chat: chat.clone(),
            source: None,
        });
        Ok(chat)
    }

    pub async fn create_chat_with_defaults(
        &self,
        mut new_chat: NewChat,
        worktree_path: Option<&str>,
        branch_name: Option<&str>,
    ) -> Result<Chat, LifecycleError> {
        let adapter_id = new_chat.adapter_id.clone();
        let mut effective_plan_mode = false;

        if new_chat.model.is_none() || new_chat.permission_mode.is_none() || !effective_plan_mode {
            let default_model = self.provider_setting(&adapter_id, "defaultModel").await;
            let default_mode = self.provider_setting(&adapter_id, "defaultMode").await;
            let default_plan_mode = self.provider_setting(&adapter_id, "defaultPlanMode").await;

            if new_chat.model.is_none()
                && let Some(m) = default_model
            {
                new_chat.model = normalize_saved_default_model(Some(&m));
            }
            if new_chat.permission_mode.is_none()
                && let Some(m) = default_mode
            {
                new_chat.permission_mode = Some(m);
            }
            if default_plan_mode.as_deref() == Some("true") {
                effective_plan_mode = true;
            }
        }

        let mut chat = self
            .create_chat(new_chat, worktree_path, branch_name)
            .await?;
        if effective_plan_mode {
            chat.plan_mode = Some(true);
            self.shared.deps.chats_update(
                &chat.id,
                &ChatPatch {
                    plan_mode: Some(true),
                    ..Default::default()
                },
            )?;
        }
        Ok(chat)
    }

    pub async fn resume_chat(&self, chat_id: &str) {
        self.load_chat(chat_id).await;

        let Some(chat) = self.chat_or_db(chat_id) else {
            return;
        };

        if chat.process_state == Some(Some(ProcessState::Working)) {
            let is_yolo = chat.permission_mode == Some(ExecutionMode::Yolo);
            // TS: `if yolo → start; else if !hasPending → start`. Both branches call
            // startChat, so the identical arms collapse to one guard (hasPending is
            // still short-circuited when yolo, matching the original evaluation).
            let no_pending = || !self.shared.permissions.lock_recover().has_pending(chat_id);
            if is_yolo || no_pending() {
                self.start_chat(chat_id).await;
            }
        }

        self.shared.emit(DaemonEvent::ChatUpdated {
            chat: chat.clone(),
            reason: None,
        });

        if let Some(todos) = chat.todos {
            self.shared.emit(DaemonEvent::TodosUpdated {
                chat_id: chat_id.to_string(),
                todos,
            });
        }
    }

    /// Returns whether this call actually reloaded the message cache from
    /// history (`do_load_chat`'s doc) — `false` for both the single-flight
    /// `Skip` (already active — untouched) and `Await` (another in-flight
    /// call owns the reload and, if it happened, that caller is the one
    /// responsible for notifying) branches.
    pub async fn load_chat(&self, chat_id: &str) -> bool {
        // Wait out an in-flight offload FIRST: it may be about to remove this
        // chat's registry cell, and this call must see the post-offload state
        // (empty registry → fresh load) rather than a half-torn-down cell.
        self.await_offload(chat_id).await;
        // Single-flight: await an in-flight load, else claim the slot (guard is
        // dropped before any `.await` — std MutexGuard is not Send).
        let action = {
            let g = self.guards.lock_recover();
            if let Some(existing) = g.loading.get(chat_id) {
                Flight::Await(existing)
            } else if self.shared.active_chats.contains_key(chat_id) {
                Flight::Skip
            } else {
                match g.loading.claim(chat_id) {
                    Ok(claim) => Flight::Claimed(claim),
                    Err(waiter) => Flight::Await(waiter),
                }
            }
        };
        let notify = match action {
            Flight::Await(existing) => {
                existing.wait().await;
                return false;
            }
            // The cell already exists: no reload needed, but this is still a
            // use — touch its clock so an unspawned cell left on screen doesn't
            // look idle just because it was never reloaded.
            Flight::Skip => {
                self.touch(chat_id);
                return false;
            }
            Flight::Claimed(n) => n,
        };
        let reloaded = self.do_load_chat(chat_id).await;
        drop(notify);
        reloaded
    }

    /// Await any in-flight load (chat_manager's `getMessages` inflight check).
    pub(crate) async fn await_loading(&self, chat_id: &str) {
        let n = self.guards.lock_recover().loading.get(chat_id);
        if let Some(n) = n {
            n.wait().await;
        }
    }

    /// Await any in-flight spawn (config_manager's `startingChats` check).
    pub(crate) async fn await_starting(&self, chat_id: &str) -> bool {
        let n = self.guards.lock_recover().starting.get(chat_id);
        if let Some(n) = n {
            n.wait().await;
            true
        } else {
            false
        }
    }

    pub async fn start_chat(&self, chat_id: &str) {
        // See `load_chat`'s matching wait: a start racing an offload must not
        // read the registry mid-teardown.
        self.await_offload(chat_id).await;
        // A start is a use, whether or not it ends up spawning.
        self.touch(chat_id);
        if let Some(cell) = self.get_active(chat_id) {
            let (spawned, process) = {
                let guard = cell.lock_recover();
                let spawned = guard.session.as_ref().is_some_and(|s| s.is_spawned());
                let process = guard.session.as_ref().and_then(|s| s.get_process_info());
                (spawned, process)
            };
            if spawned {
                if let Some(process) = process {
                    self.shared.emit(DaemonEvent::ProcessStarted {
                        chat_id: chat_id.to_string(),
                        process,
                    });
                }
                return;
            }
        }

        // Claim the single-flight slot WITHOUT
        // holding the guard across the `.await` (std MutexGuard is not Send).
        let action = {
            let g = self.guards.lock_recover();
            if let Some(existing) = g.starting.get(chat_id) {
                Flight::Await(existing)
            } else {
                match g.starting.claim(chat_id) {
                    Ok(claim) => Flight::Claimed(claim),
                    Err(waiter) => Flight::Await(waiter),
                }
            }
        };
        let notify = match action {
            Flight::Await(existing) => {
                existing.wait().await;
                return;
            }
            Flight::Skip => return, // start_chat never claims Skip
            Flight::Claimed(n) => n,
        };
        let result = self.do_start_chat(chat_id).await;
        drop(notify);
        if let Err(err) = result {
            warn!(?err, chat_id, "startChat failed");
            self.shared.emit(DaemonEvent::Error {
                chat_id: Some(chat_id.to_string()),
                error: err.to_string(),
            });
        }
    }

    pub async fn interrupt_chat(&self, chat_id: &str) {
        let Some(cell) = self.get_active(chat_id) else {
            return;
        };
        let session = {
            let guard = cell.lock_recover();
            if !guard.session.as_ref().is_some_and(|s| s.is_spawned()) {
                return;
            }
            guard.session.clone()
        };

        {
            let mut perms = self.shared.permissions.lock_recover();
            perms.clear(chat_id);
            perms.mark_interrupted(chat_id);
        }

        // SIGINT causes the CLI to exit. Track the exit so sendMessage can wait.
        let claim = self.guards.lock_recover().interrupting.claim(chat_id);
        if let Ok(claim) = claim {
            let cell_poll = cell.clone();
            tokio::spawn(async move {
                let _claim = claim;
                let deadline = tokio::time::Instant::now() + Duration::from_millis(5000);
                loop {
                    let spawned = {
                        let g = cell_poll.lock_recover();
                        g.session.as_ref().is_some_and(|s| s.is_spawned())
                    };
                    if !spawned || tokio::time::Instant::now() >= deadline {
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
    pub(crate) async fn wait_for_interrupt(&self, chat_id: &str) {
        let n = self.guards.lock_recover().interrupting.get(chat_id);
        if let Some(n) = n {
            n.wait().await;
        }
    }

    /// Stops the chat's work and marks it archived. The in-memory per-chat
    /// state is dropped afterwards by the facade's `ChatTeardown`.
    pub async fn archive_chat(&self, chat_id: &str, delete_worktree: bool) {
        let cell = self.get_active(chat_id);
        let session = cell.as_ref().and_then(|c| c.lock_recover().session.clone());
        let chat = self.chat_or_db(chat_id);

        let worktree_path = chat.as_ref().and_then(|c| c.worktree_path.clone());
        self.shared
            .deps
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
        self.shared.orchestration.revoke(chat_id);

        let project_path = chat
            .as_ref()
            .and_then(|c| self.shared.deps.projects_get_path(&c.project_id));
        let effective_path = worktree_path.clone().or_else(|| project_path.clone());

        if let (Some(chat), Some(project_path), Some(effective_path)) =
            (&chat, &project_path, &effective_path)
        {
            let last_user = is_last_active_chat_for_scope(
                &self.shared.best_effort(
                    chat_id,
                    self.shared.deps.chats_list(&chat.project_id),
                    Vec::new(),
                ),
                project_path,
                effective_path,
                chat_id,
            );
            if last_user {
                if let Some(fut) = self
                    .shared
                    .deps
                    .stop_launch_processes(&chat.project_id, effective_path)
                {
                    fut.await;
                }
                if let Some(fut) = self
                    .shared
                    .deps
                    .stop_scope_tunnels(&chat.project_id, effective_path)
                {
                    fut.await;
                }
                self.shared.emit(DaemonEvent::LaunchScopeReleased {
                    project_id: chat.project_id.clone(),
                    effective_path: effective_path.clone(),
                });
            }
        }

        if delete_worktree
            && let (Some(chat), Some(project_path)) = (&chat, &project_path)
            && let (Some(wt), Some(branch)) = (&chat.worktree_path, &chat.branch_name)
        {
            self.shared
                .deps
                .remove_worktree(project_path, wt, branch)
                .await;
        }

        self.shared.deps.attachment_delete_chat(chat_id).await;
        self.shared.best_effort(
            chat_id,
            self.shared.deps.chats_update(
                chat_id,
                &ChatPatch {
                    status: Some(ChatStatus::Archived),
                    ..Default::default()
                },
            ),
            (),
        );
        info!(chat_id, "chat archived");
        self.shared.emit(DaemonEvent::ChatEnded {
            chat_id: chat_id.to_string(),
        });
    }

    /// Stop a running session without ending the chat.
    pub(crate) async fn stop_chat(&self, chat_id: &str) {
        let Some(cell) = self.get_active(chat_id) else {
            return;
        };
        let session = cell.lock_recover().session.clone();
        let Some(session) = session else {
            return;
        };
        if session.is_spawned()
            && let Err(err) = session.kill().await
        {
            warn!(?err, chat_id, "session.kill failed on stopChat");
        }
        self.shared.orchestration.revoke(chat_id);
        cell.lock_recover().session = None;
    }

    /// Stops the chat's session and marks it ended. The in-memory per-chat
    /// state is dropped afterwards by the facade's `ChatTeardown`.
    pub async fn end_chat(&self, chat_id: &str) {
        let Some(cell) = self.get_active(chat_id) else {
            return;
        };
        let session = cell.lock_recover().session.clone();

        self.shared
            .deps
            .kill_tasks_for_chat(chat_id, None, session.clone())
            .await;

        if let Some(session) = &session
            && let Err(err) = session.kill().await
        {
            warn!(?err, chat_id, "session.kill failed on endChat");
        }
        self.shared.orchestration.revoke(chat_id);

        self.shared.best_effort(
            chat_id,
            self.shared.deps.chats_update(
                chat_id,
                &ChatPatch {
                    status: Some(ChatStatus::Ended),
                    ..Default::default()
                },
            ),
            (),
        );
        self.shared.emit(DaemonEvent::ChatEnded {
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
            .ok_or_else(|| NotFound::new("Chat", chat_id))?;
        let project_path = self
            .shared
            .deps
            .projects_get_path(&source_chat.project_id)
            .ok_or_else(|| NotFound::unnamed("Project"))?;

        if self.shared.deps.is_working_tree_dirty(&project_path).await {
            return Err(LifecycleError::DirtyWorkingTree);
        }

        let new_chat = self
            .create_chat(
                NewChat {
                    project_id: source_chat.project_id.clone(),
                    adapter_id: source_chat.adapter_id.clone(),
                    model: source_chat.model.clone(),
                    permission_mode: source_chat.permission_mode.map(|m| m.as_str().to_string()),
                    // A fork always creates a durable, project-scoped chat (an
                    // existing caller passing temporary=false, rule 2).
                    temporary: false,
                    automation_run_id: None,
                    scratch_root: None,
                },
                None,
                None,
            )
            .await?;
        // The `enableWorktree(newChatId, base, branch)` step is owned by
        // chat_manager (it holds the config_manager); it invokes this via the
        // returned new chat id.
        Ok(new_chat.id)
    }

    /// A multi-segment chat's composed history and the index its active
    /// segment starts at; `None` for a single-segment chat, loaded from its
    /// one session as before segments existed.
    async fn compose_history(&self, chat_id: &str) -> Option<(Vec<ChatMessage>, usize)> {
        let composed =
            crate::chat_manager::compose_if_multi(self.shared.deps.as_ref(), chat_id).await?;
        Some((composed.messages, composed.active_from))
    }

    pub(crate) async fn do_generate_title(&self, chat_id: &str, content: &str) {
        // The title task is spawned, so it can outlive the chat it was
        // spawned for (#287): a bare unlogged return here was indistinguishable
        // from every other silent title-generation outcome.
        let Some(cell) = self.get_active(chat_id) else {
            debug!(
                chat_id,
                reason = "chat_not_active",
                "title generation skipped"
            );
            return;
        };
        let adapter_id = cell.lock_recover().chat.adapter_id.clone();
        if read_setting(
            self.shared.deps.settings(),
            "general",
            "titleGeneration.disabled",
        )
        .await
        .as_deref()
            == Some("true")
        {
            debug!(
                chat_id,
                adapter_id = %adapter_id,
                reason = "disabled_by_setting",
                "title generation skipped"
            );
            return;
        }
        let binary = resolve_title_binary(
            self.provider_setting(&adapter_id, "titleBinary").await,
            &adapter_id,
        );

        if let Some(title) = self
            .shared
            .deps
            .generate_title(&adapter_id, content, &binary)
            .await
        {
            self.apply_generated_title(&cell, title);
        } else {
            debug!(
                chat_id,
                adapter_id = %adapter_id,
                reason = "no_title",
                "title generation produced no title"
            );
        }
    }

    fn apply_generated_title(&self, cell: &Arc<Mutex<ActiveChat>>, title: String) {
        let chat = {
            let mut guard = cell.lock_recover();
            guard.chat.title = Some(title.clone());
            guard.chat.clone()
        };
        self.shared
            .prepare_live_update(
                &chat.id,
                &ChatPatch {
                    title: Some(title),
                    ..Default::default()
                },
            )
            .emit(chat, None);
    }

    /// The no-persistence context-loss transition. No-op unless
    /// `no_persistence::context_was_lost` is true for `chat`'s current fields;
    /// otherwise persists the loss, clears the dead resume target on both the
    /// passed-in `chat` and the active cell (if any), and broadcasts the
    /// update — called before either `do_load_chat` or `do_start_chat` reads
    /// `claude_session_id` as a resume target.
    fn mark_context_lost_if_needed(&self, chat_id: &str, chat: &mut Chat) {
        let now = now_iso8601();
        if !no_persistence::take_context_loss(chat, &now) {
            return;
        }
        self.shared.best_effort(
            chat_id,
            self.shared.deps.mark_context_lost(chat_id, &now),
            (),
        );
        if let Some(cell) = self.get_active(chat_id) {
            cell.lock_recover().chat = chat.clone();
        }
        self.shared.emit(DaemonEvent::ChatUpdated {
            chat: chat.clone(),
            reason: None,
        });
    }

    /// Returns whether this call actually changed the message cache —
    /// `ChatManager::load_chat` uses it to decide whether an attached facade
    /// session needs a `Resync` (a chat left on screen through an idle offload
    /// keeps its facade session, which offload deliberately leaves un-notified
    /// — see `idle_offload.rs`'s step 4 — so the NEXT `load_chat` is what
    /// rebuilds the cache under the transcript's own ids and must tell that
    /// attached session to re-replay rather than diff against the ids it cached
    /// live). An identical reload of an already-warm cache — a cold chat's
    /// first send after `session/resume` — raises no resync: "no previous
    /// entry" counts as changed, an unchanged list does not.
    async fn do_load_chat(&self, chat_id: &str) -> bool {
        let Some(mut chat) =
            storage_event!(self.shared, Some(chat_id); self.shared.deps.chats_get(chat_id), false)
        else {
            warn!(chat_id, "doLoadChat: chat not found");
            return false;
        };
        self.shared.active_chats.insert(
            chat_id.to_string(),
            Arc::new(Mutex::new(ActiveChat::new(chat.clone(), None))),
        );
        self.shared.messages.lock_recover().pin(chat_id);

        // Before any resume target is read below, a dead ephemeral session's
        // context loss must be marked (clears `claude_session_id`, so the early
        // return just past it fires and no session is created).
        self.mark_context_lost_if_needed(chat_id, &mut chat);

        let project_path = self.shared.deps.projects_get_path(&chat.project_id);
        let Some(effective_path) = chat_cwd(
            chat.worktree_path.as_deref(),
            chat.scratch_path.as_deref(),
            project_path.clone(),
        ) else {
            return false;
        };
        // Before the early returns below: a chat with no session still needs a
        // baseline, and it must be re-seeded on every activation after a restart.
        // A non-project chat has no worktrees to baseline (`project_path` is
        // `None` for the hidden scratch row).
        if let Some(project_path) = &project_path {
            self.worktree_offers
                .seed_baseline(chat_id, project_path)
                .await;
        }

        if let Some(wt) = &chat.worktree_path
            && !self.shared.deps.path_exists(wt)
        {
            return false;
        }

        // A fork's own session id may not exist yet (its first turn never ran)
        // or may exist but crashed before the CLI wrote its transcript — either
        // way, `fork_source` rides along so the adapter's own resolver
        // (`resolve_resume`) can fall back to the pinned snapshot. Only a chat
        // with neither an own id nor a pending fork has nothing to resume.
        // A multi-segment chat composes every segment's history, even while
        // its active segment has no session yet (switched, nothing sent):
        // returning early below would hide the earlier segments.
        let composed = self.compose_history(chat_id).await;
        let own_id = chat.claude_session_id.clone();
        let fork_source = storage_event!(
            self.shared, Some(chat_id);
            self.shared.deps.get_pending_fork(chat_id),
            false
        )
        .map(|pending| pending.fork_source);
        if own_id.is_none() && fork_source.is_none() {
            return match composed {
                Some(history) => self.finish_load(chat_id, Some(history)).await,
                None => false,
            };
        }

        let Some(session) = self.shared.deps.create_session(
            &chat.adapter_id,
            SessionOptions {
                project_path: effective_path,
                chat_id: own_id,
                mainframe_chat_id: chat_id.to_string(),
                session_file_path: chat.session_file_path.clone(),
                fork_source,
            },
        ) else {
            return false;
        };
        if let Some(cell) = self.get_active(chat_id) {
            cell.lock_recover().session = Some(session.clone());
        }

        let history = match composed {
            Some(history) => Some(history),
            None => session.load_history().await.ok().map(|history| {
                let remapped: Vec<_> = history
                    .into_iter()
                    .map(|mut m| {
                        m.chat_id = chat_id.to_string();
                        m
                    })
                    .collect();
                (remapped, 0)
            }),
        };
        self.finish_load(chat_id, history).await
    }

    /// Settles a loaded history into the cache, restores a pending permission
    /// from the active segment's slice only (`active_from`), runs the
    /// post-load scan, and raises a resync when the cache changed.
    async fn finish_load(&self, chat_id: &str, history: Option<(Vec<ChatMessage>, usize)>) -> bool {
        let mut cache_reloaded = false;
        if let Some((remapped, active_from)) = history
            && !remapped.is_empty()
        {
            let mut messages = self.shared.messages.lock_recover();
            let previous = messages.get(chat_id).cloned();
            messages.set(chat_id, remapped);
            let remapped = messages.get(chat_id).cloned().unwrap_or_default();
            drop(messages);
            let active_slice = &remapped[active_from.min(remapped.len())..];
            self.shared
                .permissions
                .lock_recover()
                .restore_pending_permission(chat_id, active_slice);
            // Raise the resync only when the reload actually changed the
            // cached list — "no previous entry" counts as changed, but a
            // cold chat's identical re-read (the first send after
            // `session/resume`) must not force a full replay (finding 6).
            cache_reloaded = previous.as_ref() != Some(&remapped);
        }

        // Mention extraction and the PR-URL scan are adapter-specific and out
        // of this crate's dep set, so the whole post-load scan is one injected
        // seam; `mainframe-server`'s `chat_deps.rs` implements it over the
        // session's own history.
        self.shared.deps.scan_loaded_history(chat_id).await;
        if cache_reloaded {
            // Notify here, not just from the public `load_chat` wrapper: a
            // resumed SEND also reaches this via `do_start_chat`'s own
            // `self.load_chat(chat_id)` call, a path `ChatManager::load_chat`
            // never sees (an on-screen chat that sends after an idle offload
            // must resync through this branch too, not just an explicit
            // reopen).
            chat_surface::notify(
                self.chat_surface.get(),
                ChatSurfaceEvent::Resync {
                    chat_id: chat_id.to_string(),
                },
            );
        }
        cache_reloaded
    }

    /// One `provider.<adapter>.<field>` setting; `None` when unset or unreadable.
    async fn provider_setting(&self, adapter_id: &str, field: &str) -> Option<String> {
        read_setting(
            self.shared.deps.settings(),
            "provider",
            &format!("{adapter_id}.{field}"),
        )
        .await
    }

    async fn default_model_for(&self, adapter_id: &str) -> Option<String> {
        let saved = self.provider_setting(adapter_id, "defaultModel").await;
        normalize_saved_default_model(saved.as_deref()).filter(|model| model != "default")
    }

    async fn do_start_chat(&self, chat_id: &str) -> Result<(), LifecycleError> {
        self.load_chat(chat_id).await;

        let cell = self
            .get_active(chat_id)
            .ok_or_else(|| LifecycleError::NotLoaded(chat_id.to_string()))?;

        let (spawned, process, mut chat) = {
            let guard = cell.lock_recover();
            (
                guard.session.as_ref().is_some_and(|s| s.is_spawned()),
                guard.session.as_ref().and_then(|s| s.get_process_info()),
                guard.chat.clone(),
            )
        };
        if spawned {
            if let Some(process) = process {
                self.shared.emit(DaemonEvent::ProcessStarted {
                    chat_id: chat_id.to_string(),
                    process,
                });
            }
            return Ok(());
        }

        if let Some(wt) = &chat.worktree_path
            && !self.shared.deps.path_exists(wt)
        {
            return Err(LifecycleError::WorktreeMissing(wt.clone()));
        }

        let project_path = self.shared.deps.projects_get_path(&chat.project_id);
        // Clear a dead resume target (and stamp the loss) before it is read
        // into `SessionOptions.chat_id` below.
        self.mark_context_lost_if_needed(chat_id, &mut chat);
        // The effective cwd (ensuring a non-project chat's scratch directory
        // along the way) and the no-persistence decision.
        let plan = self.resolve_spawn_plan(&chat, project_path).await?;

        // See `do_load_chat`'s comment: a fork's own id and its pending-fork
        // source can both be present (a crashed first turn already got an
        // `on_init`), so both ride along and the adapter's own resolver decides.
        let fork_source = self
            .shared
            .deps
            .get_pending_fork(chat_id)?
            .map(|pending| pending.fork_source);
        let session = self
            .shared
            .deps
            .create_session(
                &chat.adapter_id,
                SessionOptions {
                    project_path: plan.cwd,
                    chat_id: chat.claude_session_id.clone(),
                    mainframe_chat_id: chat_id.to_string(),
                    session_file_path: chat.session_file_path.clone(),
                    fork_source,
                },
            )
            .ok_or_else(|| NotFound::new("Adapter", chat.adapter_id.clone()))?;
        cell.lock_recover().session = Some(session.clone());

        if chat.adapter_id == "codex" {
            self.shared.deps.apply_codex_provider_tuning(&session);
        }

        let sink = self
            .event_handler
            .build_sink(chat_id, Some(session.id().to_string()));

        let executable_path = self
            .provider_setting(&chat.adapter_id, "executablePath")
            .await;
        let system_prompt = self
            .provider_setting(&chat.adapter_id, "systemPrompt")
            .await;
        let small_fast_model = self
            .provider_setting(&chat.adapter_id, "cliproxySmallFastModel")
            .await;
        let tuning = self.shared.deps.resolve_tuning(chat_id).await;
        let default_model = self.default_model_for(&chat.adapter_id).await;

        // The no-persistence flag write: persisted and mirrored into the active
        // chat before the spawn, so `on_init`'s stored provider id lands with
        // the right ephemeral flag already in place.
        self.apply_no_persistence_flag(&chat.id, &cell, plan.no_persistence);

        let process = session
            .spawn(
                Some(SessionSpawnOptions {
                    model: chat.model.clone().or_else(|| default_model.clone()),
                    permission_mode: chat.permission_mode,
                    plan_mode: Some(chat.plan_mode.unwrap_or(false)),
                    executable_path,
                    system_prompt,
                    tuning,
                    small_fast_model,
                    default_model,
                    no_persistence: Some(plan.no_persistence),
                    orchestration_mcp: self.shared.orchestration.issue(chat_id, session.id()),
                }),
                Some(sink),
            )
            .await?;
        info!(chat_id, "chat session started");
        self.shared.emit(DaemonEvent::ProcessStarted {
            chat_id: chat_id.to_string(),
            process,
        });
        Ok(())
    }
}

/// Offload/send/history single-flight claims sharing the `Guards` above. A child
/// module so it can see the private `Guards`/`Flight` without
/// widening their visibility.
mod flight_claims;

#[cfg(test)]
mod title_logging_tests;

#[cfg(test)]
mod orchestration_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fork::PendingForkState;
    use crate::test_support::{FakeSession, test_chat};
    use mainframe_adapter_api::AdapterSession;
    use mainframe_types::settings_kv::{MemorySettings, SettingsKv as _};

    pub(super) fn chat_over(id: &str, worktree: Option<&str>, status: ChatStatus) -> Chat {
        let mut c = test_chat(id);
        c.worktree_path = worktree.map(str::to_string);
        c.status = status;
        c
    }

    // ── is_last_active_chat_for_scope ─────────────────────────────────────────
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
    pub(super) use crate::test_support::FakeDeps;

    /// The shared fake with `chat` and its `siblings` stored in a project at
    /// `/proj` whose launch scope can be stopped.
    pub(super) fn fake(chat: Chat, siblings: Vec<Chat>) -> Arc<FakeDeps> {
        let mut chats = vec![chat];
        chats.extend(siblings);
        let deps = FakeDeps::with_chats(chats);
        deps.set_project_path("/proj");
        *deps.workspace.has_launches.lock().unwrap() = true;
        deps
    }

    /// `fake`, over a scope that never ran a launch config (where
    /// `LaunchRegistry::get` yields `None` and `stop_launch_processes` with it).
    fn launchless(chat: Chat, siblings: Vec<Chat>) -> Arc<FakeDeps> {
        let deps = fake(chat, siblings);
        *deps.workspace.has_launches.lock().unwrap() = false;
        deps
    }

    pub(super) fn title_disabled(chat: Chat) -> Arc<FakeDeps> {
        let deps = FakeDeps {
            settings: MemorySettings::default().with("general", "titleGeneration.disabled", "true"),
            ..FakeDeps::default()
        };
        deps.store.insert(chat);
        deps.set_project_path("/proj");
        *deps.workspace.has_launches.lock().unwrap() = true;
        Arc::new(deps)
    }

    /// Like [`fake`], but `adapter_supports_no_persistence` answers `true`
    /// and `create_session` hands out `session` (so `do_start_chat` reaches
    /// the rule-7 flag write before its `spawn()` call).
    pub(super) fn no_persistence_capable(
        chat: Chat,
        session: Arc<dyn AdapterSession>,
    ) -> Arc<FakeDeps> {
        let deps = fake(chat, Vec::new());
        deps.set_session_to_return(session);
        *deps.adapters.no_persistence_capability.lock().unwrap() = true;
        deps
    }

    /// Titles the store observed `chats_update` writing.
    pub(super) fn title_updates(deps: &FakeDeps) -> Vec<String> {
        deps.store
            .updates
            .lock()
            .unwrap()
            .iter()
            .filter_map(|(_, patch)| patch.title.clone())
            .collect()
    }

    /// Every `vendor_session_ephemeral` value `chats_update` observed.
    fn vendor_session_ephemeral_updates(deps: &FakeDeps) -> Vec<bool> {
        deps.store
            .updates
            .lock()
            .unwrap()
            .iter()
            .filter_map(|(_, patch)| patch.vendor_session_ephemeral)
            .collect()
    }

    async fn set_saved_default_model(deps: &FakeDeps, adapter_id: &str, model: Option<&str>) {
        let key = format!("{adapter_id}.defaultModel");
        match model {
            Some(model) => deps.settings.set("provider", &key, model).await.unwrap(),
            None => deps.settings.delete("provider", &key).await.unwrap(),
        }
    }

    /// A lifecycle manager over `deps`, with the event handler and offer
    /// registry it needs built over the same shared state.
    pub(super) fn manager(deps: Arc<FakeDeps>) -> ChatLifecycleManager {
        let shared = ChatShared::new(deps);
        let offers = Arc::new(WorktreeOfferRegistry::new(shared.clone()));
        let handler = Arc::new(EventHandler::new(shared.clone(), offers.clone()));
        ChatLifecycleManager::new(shared, handler, offers)
    }

    #[tokio::test]
    async fn fork_to_worktree_keeps_accept_edits_permission_mode() {
        let mut source = chat_over("source", None, ChatStatus::Active);
        source.permission_mode = Some(ExecutionMode::AcceptEdits);
        let deps = fake(source, Vec::new());
        let mgr = manager(deps.clone());

        mgr.fork_to_worktree("source", "main", "feature")
            .await
            .unwrap();

        let created = deps.store.created.lock().unwrap();
        let permission = created[0].permission_mode.as_deref();
        assert_eq!(permission, Some("acceptEdits"));
        let parsed: ExecutionMode =
            serde_json::from_value(serde_json::Value::String(permission.unwrap().to_string()))
                .unwrap();
        assert_eq!(parsed, ExecutionMode::AcceptEdits);
    }

    #[tokio::test]
    async fn calls_kill_tasks_before_session_kill_with_worktree_path() {
        let chat = {
            let mut c = chat_over("c1", Some("/wt/x"), ChatStatus::Active);
            c.branch_name = Some("feat/x".to_string());
            c
        };
        let deps = fake(chat.clone(), Vec::new());
        let mgr = manager(deps.clone());
        // Insert an active chat whose FakeSession records its own kill order.
        let session = FakeSession::with_activity(true, None);
        mgr.shared.active_chats.insert(
            "c1".to_string(),
            Arc::new(Mutex::new(ActiveChat::new(chat, Some(session.clone())))),
        );

        mgr.archive_chat("c1", true).await;

        // killTasksForChat is called (with the worktree path) BEFORE session.kill;
        // the deps seam records the kill-tasks call and FakeSession counts its kill.
        let order = deps.workspace.order.lock().unwrap();
        assert!(order.iter().any(|s| s == "kill:c1:/wt/x"));
        assert_eq!(session.kills(), 1);
    }

    #[tokio::test]
    async fn last_user_stops_launches_and_emits_scope_released() {
        let chat = {
            let mut c = chat_over("c1", Some("/wt/x"), ChatStatus::Active);
            c.branch_name = Some("feat/x".to_string());
            c
        };
        let deps = fake(chat, Vec::new());
        let mgr = manager(deps.clone());
        mgr.archive_chat("c1", false).await; // keep-worktree

        assert_eq!(
            deps.workspace.stop_calls.lock().unwrap().as_slice(),
            &[("p1".to_string(), "/wt/x".to_string())]
        );
        assert_eq!(
            deps.workspace.tunnel_stop_calls.lock().unwrap().as_slice(),
            &[("p1".to_string(), "/wt/x".to_string())]
        );
        assert!(deps.emitter.events.lock().unwrap().iter().any(|e| matches!(
            e,
            DaemonEvent::LaunchScopeReleased { project_id, effective_path }
                if project_id == "p1" && effective_path == "/wt/x"
        )));
    }

    /// Port tunnels outlive every scope whose teardown hangs off the launch
    /// registry: a chat that never ran a launch config gets `None` from
    /// `stop_launch_processes`, so the tunnel stop has to be its own seam.
    #[tokio::test]
    async fn launchless_scope_release_still_stops_port_tunnels() {
        let chat = {
            let mut c = chat_over("c1", Some("/wt/x"), ChatStatus::Active);
            c.branch_name = Some("feat/x".to_string());
            c
        };
        let deps = launchless(chat, Vec::new());
        let mgr = manager(deps.clone());
        mgr.archive_chat("c1", false).await;

        assert!(deps.workspace.stop_calls.lock().unwrap().is_empty());
        assert_eq!(
            deps.workspace.tunnel_stop_calls.lock().unwrap().as_slice(),
            &[("p1".to_string(), "/wt/x".to_string())]
        );
        assert!(deps.emitter.events.lock().unwrap().iter().any(|e| matches!(
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
        let deps = fake(chat, vec![sibling]);
        let mgr = manager(deps.clone());
        mgr.archive_chat("c1", false).await;

        assert!(deps.workspace.stop_calls.lock().unwrap().is_empty());
        assert!(deps.workspace.tunnel_stop_calls.lock().unwrap().is_empty());
        assert!(
            !deps
                .emitter
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
        let deps = fake(chat, Vec::new());
        let mgr = manager(deps.clone());
        mgr.archive_chat("c1", false).await;

        assert_eq!(
            deps.workspace.stop_calls.lock().unwrap().as_slice(),
            &[("p1".to_string(), "/proj".to_string())]
        );
        assert_eq!(
            deps.workspace.tunnel_stop_calls.lock().unwrap().as_slice(),
            &[("p1".to_string(), "/proj".to_string())]
        );
        assert!(deps.emitter.events.lock().unwrap().iter().any(|e| matches!(
            e,
            DaemonEvent::LaunchScopeReleased { effective_path, .. } if effective_path == "/proj"
        )));
    }

    #[tokio::test]
    async fn start_chat_emits_a_chat_scoped_error_when_the_project_directory_is_gone() {
        let chat = chat_over("c1", None, ChatStatus::Active);
        let deps = fake(chat, Vec::new());
        deps.paths.set_present_paths(&[]);
        let mgr = manager(deps.clone());

        mgr.start_chat("c1").await;

        let events = deps.emitter.events.lock().unwrap();
        assert!(events.iter().any(|event| matches!(
            event,
            DaemonEvent::Error { chat_id: Some(chat_id), error }
                if chat_id == "c1"
                    && error.contains("Project directory does not exist or is not accessible")
                    && error.contains("/proj")
        )));
        assert!(
            !events
                .iter()
                .any(|event| matches!(event, DaemonEvent::ProcessStarted { .. }))
        );
    }

    #[tokio::test]
    async fn start_chat_emits_a_chat_scoped_error_when_the_worktree_is_gone() {
        let chat = chat_over("c1", Some("/wt/gone"), ChatStatus::Active);
        let deps = fake(chat, Vec::new());
        deps.paths.set_present_paths(&["/proj"]);
        let mgr = manager(deps.clone());

        mgr.start_chat("c1").await;

        let events = deps.emitter.events.lock().unwrap();
        assert!(events.iter().any(|event| matches!(
            event,
            DaemonEvent::Error { chat_id: Some(chat_id), error }
                if chat_id == "c1"
                    && error.contains("Worktree directory does not exist")
                    && error.contains("/wt/gone")
        )));
        assert!(
            !events
                .iter()
                .any(|event| matches!(event, DaemonEvent::ProcessStarted { .. }))
        );
    }

    #[tokio::test]
    async fn start_chat_proceeds_when_the_worktree_is_live_and_the_project_path_is_gone() {
        let chat = chat_over("c1", Some("/wt/live"), ChatStatus::Active);
        let deps = fake(chat, Vec::new());
        deps.paths.set_present_paths(&["/wt/live"]);
        let mgr = manager(deps.clone());

        mgr.start_chat("c1").await;

        let events = deps.emitter.events.lock().unwrap();
        assert!(!events.iter().any(|event| matches!(
            event,
            DaemonEvent::Error { error, .. }
                if error.contains("Project directory does not exist or is not accessible")
                    && error.contains("/proj")
        )));
    }

    // ── the no-persistence spawn decision ─────────────────────────────────────
    #[tokio::test]
    async fn temporary_and_capable_writes_the_ephemeral_flag_before_spawning() {
        let mut chat = chat_over("c1", None, ChatStatus::Active);
        chat.temporary = true;
        let deps = no_persistence_capable(chat, FakeSession::with_activity(false, None));
        let mgr = manager(deps.clone());

        mgr.start_chat("c1").await;

        assert_eq!(vendor_session_ephemeral_updates(&deps).as_slice(), &[true]);
    }

    #[tokio::test]
    async fn not_temporary_never_writes_the_ephemeral_flag_even_when_capable() {
        let chat = chat_over("c1", None, ChatStatus::Active); // temporary: false (default)
        let deps = no_persistence_capable(chat, FakeSession::with_activity(false, None));
        let mgr = manager(deps.clone());

        mgr.start_chat("c1").await;

        assert_eq!(vendor_session_ephemeral_updates(&deps).as_slice(), &[false]);
    }

    #[tokio::test]
    async fn temporary_without_the_capability_never_writes_the_ephemeral_flag() {
        let mut chat = chat_over("c1", None, ChatStatus::Active);
        chat.temporary = true;
        let deps = fake(chat, Vec::new());
        deps.set_session_to_return(FakeSession::with_activity(false, None));
        let mgr = manager(deps.clone());

        mgr.start_chat("c1").await;

        assert_eq!(vendor_session_ephemeral_updates(&deps).as_slice(), &[false]);
    }

    #[tokio::test]
    async fn a_dead_ephemeral_resume_target_is_cleared_before_the_spawn_reads_it() {
        let mut chat = chat_over("c1", None, ChatStatus::Active);
        chat.temporary = true;
        chat.vendor_session_ephemeral = true;
        chat.claude_session_id = Some("dead-sess".to_string());
        let deps = no_persistence_capable(chat, FakeSession::with_activity(false, None));
        let mgr = manager(deps.clone());

        mgr.start_chat("c1").await;

        assert_eq!(deps.store.mark_context_lost_calls.lock().unwrap().len(), 1);
        assert_eq!(
            deps.store.mark_context_lost_calls.lock().unwrap()[0].0,
            "c1"
        );
        // The dead id must never reach `create_session` as a resume target.
        let calls = deps.adapters.created_sessions.lock().unwrap();
        assert!(calls.iter().all(|o| o.chat_id.is_none()));
    }

    #[tokio::test]
    async fn a_non_project_chat_ensures_its_scratch_directory_on_every_start() {
        let mut chat = chat_over("c1", None, ChatStatus::Active);
        chat.scratch_path = Some("/data/scratch/c1".to_string());
        let deps = fake(chat, Vec::new());
        deps.set_session_to_return(FakeSession::with_activity(false, None));
        let mgr = manager(deps.clone());

        mgr.start_chat("c1").await;

        assert_eq!(
            deps.paths.ensure_dir_calls.lock().unwrap().as_slice(),
            &["/data/scratch/c1".to_string()]
        );
        // Its cwd is the scratch path, not the (unrelated) project path.
        assert_eq!(
            deps.adapters.created_sessions.lock().unwrap()[0].project_path,
            "/data/scratch/c1"
        );
    }

    #[tokio::test]
    async fn a_project_chat_never_calls_ensure_dir() {
        let chat = chat_over("c1", None, ChatStatus::Active);
        let deps = fake(chat, Vec::new());
        deps.set_session_to_return(FakeSession::with_activity(false, None));
        let mgr = manager(deps.clone());

        mgr.start_chat("c1").await;

        assert!(deps.paths.ensure_dir_calls.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn default_model_for_uses_only_explicit_provider_settings() {
        let deps = fake(chat_over("c1", None, ChatStatus::Active), Vec::new());
        let mgr = manager(deps.clone());
        for (saved, expected) in [
            (Some("custom-model"), Some("custom-model")),
            (Some("default"), None),
            (Some(""), None),
            (None, None),
        ] {
            set_saved_default_model(&deps, "codex", saved).await;
            assert_eq!(mgr.default_model_for("codex").await.as_deref(), expected);
        }
    }

    fn pending_fork() -> PendingForkState {
        PendingForkState {
            fork_source: mainframe_types::adapter::ForkSource {
                source_session_id: "parent-session".to_string(),
                resume_path: Some("/tmp/fork-snapshots/n1/parent-session.jsonl".to_string()),
                last_turn_id: None,
            },
            snapshot_dir: "/tmp/fork-snapshots/n1".to_string(),
            provisional_title: "Untitled (fork)".to_string(),
        }
    }

    #[tokio::test]
    async fn do_load_chat_resumes_an_unsent_fork_from_its_pending_fork_source() {
        let chat = chat_over("fork-1", None, ChatStatus::Active);
        let deps = fake(chat, Vec::new());
        deps.set_pending_fork("fork-1", pending_fork());
        deps.set_session_to_return(FakeSession::with_activity(false, None));
        let mgr = manager(deps.clone());

        mgr.load_chat("fork-1").await;

        let calls = deps.adapters.created_sessions.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].chat_id, None);
        assert_eq!(calls[0].fork_source, Some(pending_fork().fork_source));
    }

    /// A chat with neither its own session nor a pending fork still bails out
    /// before ever calling `create_session` — the pre-existing behavior for
    /// every non-fork chat with no session yet.
    #[tokio::test]
    async fn do_load_chat_skips_session_creation_with_no_session_and_no_pending_fork() {
        let chat = chat_over("c1", None, ChatStatus::Active);
        let deps = fake(chat, Vec::new());
        let mgr = manager(deps.clone());

        mgr.load_chat("c1").await;

        assert!(deps.adapters.created_sessions.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn do_start_chat_passes_the_pending_fork_source_to_the_spawn_session() {
        let chat = chat_over("fork-1", None, ChatStatus::Active);
        let deps = fake(chat, Vec::new());
        deps.set_pending_fork("fork-1", pending_fork());
        // Not spawned, so `start_chat` proceeds past `do_load_chat`'s session to
        // build (and record the options for) a fresh spawn session.
        deps.set_session_to_return(FakeSession::with_activity(false, None));
        let mgr = manager(deps.clone());

        mgr.start_chat("fork-1").await;

        let calls = deps.adapters.created_sessions.lock().unwrap();
        let last = calls.last().expect("start_chat builds a spawn session");
        assert_eq!(last.chat_id, None);
        assert_eq!(last.fork_source, Some(pending_fork().fork_source));
    }
}

#[cfg(test)]
mod storage_tests;
