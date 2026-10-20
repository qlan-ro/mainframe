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

mod history;
mod load_history;
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
        /* expected */
        let _ = self.chat_surface.set(surface); // First attachment wins.
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
            warn!(error = ?err, chat_id, "startChat failed");
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
            warn!(error = ?err, chat_id, "interrupt failed");
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
            warn!(error = ?err, chat_id, "session.kill failed on archive");
        }
        self.shared.orchestration.revoke(chat_id);

        let project_path = chat
            .as_ref()
            .and_then(|c| self.shared.deps.projects_get_path(&c.project_id));
        let effective_path = worktree_path.clone().or_else(|| project_path.clone());

        self.release_archived_scope(chat_id, &chat, &project_path, &effective_path)
            .await;

        if delete_worktree
            && let (Some(chat), Some(project_path)) = (&chat, &project_path)
            && let (Some(wt), Some(branch)) = (&chat.worktree_path, &chat.branch_name)
        {
            self.shared
                .deps
                .remove_worktree(project_path, wt, branch)
                .await;
        }

        self.finish_archive(chat_id).await;
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
            warn!(error = ?err, chat_id, "session.kill failed on stopChat");
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
            warn!(error = ?err, chat_id, "session.kill failed on endChat");
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
    /// `vendor_session_id` as a resume target.
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

        let session = self.create_start_session(chat_id, &chat, plan.cwd)?;
        cell.lock_recover().session = Some(session.clone());

        let sink = self
            .event_handler
            .build_sink(chat_id, Some(session.id().to_string()));

        let mut options = self
            .session_spawn_options(chat_id, &chat, plan.no_persistence)
            .await;

        // The no-persistence flag write: persisted and mirrored into the active
        // chat before the spawn, so `on_init`'s stored provider id lands with
        // the right ephemeral flag already in place.
        self.apply_no_persistence_flag(&chat.id, &cell, plan.no_persistence);

        options.orchestration_mcp = self.shared.orchestration.issue(chat_id, session.id());
        let process = session.spawn(Some(options), Some(sink)).await?;
        info!(chat_id, "chat session started");
        self.shared.emit(DaemonEvent::ProcessStarted {
            chat_id: chat_id.to_string(),
            process,
        });
        Ok(())
    }
    async fn release_archived_scope(
        &self,
        chat_id: &str,
        chat: &Option<Chat>,
        project_path: &Option<String>,
        effective_path: &Option<String>,
    ) {
        if let (Some(chat), Some(project_path), Some(effective_path)) =
            (chat, project_path, effective_path)
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
    }

    async fn prepare_load(&self, chat_id: &str) -> Option<(Chat, String)> {
        let Some(mut chat) =
            storage_event!(self.shared, Some(chat_id); self.shared.deps.chats_get(chat_id), None)
        else {
            warn!(chat_id, "chat not found");
            return None;
        };
        self.shared.active_chats.insert(
            chat_id.to_string(),
            Arc::new(Mutex::new(ActiveChat::new(chat.clone(), None))),
        );
        self.shared.messages.lock_recover().pin(chat_id);

        // Before any resume target is read below, a dead ephemeral session's
        // context loss must be marked (clears `vendor_session_id`, so the early
        // return just past it fires and no session is created).
        self.mark_context_lost_if_needed(chat_id, &mut chat);

        let project_path = self.shared.deps.projects_get_path(&chat.project_id);
        let effective_path = chat_cwd(
            chat.worktree_path.as_deref(),
            chat.scratch_path.as_deref(),
            project_path.clone(),
        )?;
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
            return None;
        }

        Some((chat, effective_path))
    }
}

/// Offload/send/history single-flight claims sharing the `Guards` above. A child
/// module so it can see the private `Guards`/`Flight` without
/// widening their visibility.
mod flight_claims;

mod session_helpers;
#[cfg(test)]
mod title_logging_tests;

#[cfg(test)]
mod orchestration_tests;

#[cfg(test)]
#[path = "lifecycle_manager_tests.rs"]
mod tests;

#[cfg(test)]
mod storage_tests;
