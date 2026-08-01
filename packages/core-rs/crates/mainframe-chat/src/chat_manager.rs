//! Ported from `packages/core/src/chat/chat-manager.ts`.
//!
//! The TS `ChatManager` owns `messages`/`permissions`/`activeChats`/`queuedRefs`
//! and wires the sub-managers with closures over `this`. The Rust port keeps the
//! shared PER_ENTITY caches behind `Arc<Mutex<..>>` / `Arc<DashMap<..>>` and wires
//! the sub-managers with concrete delegating `Deps` wrappers (`EhDeps`/`LcDeps`/
//! `PhDeps`) that all hold the SAME `Arc<dyn ChatManagerDeps>` + shared state — the
//! Rust analogue of the TS closure bag. Non-generic (`dyn ChatManagerDeps`) to
//! avoid generic self-recursion in the wiring.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use dashmap::DashMap;
use mainframe_adapter_api::{
    AdapterError, AdapterSession, BoxFuture, ImageInput, PlanModeActionHandler, SessionSink,
};
use mainframe_runtime::time::now_iso8601;
use mainframe_services::commands::{find_mainframe_command, wrap_mainframe_command};
use mainframe_services::workspace::is_worktree_present;
use mainframe_services::workspace::worktree::is_directory_present;
use mainframe_types::adapter::{
    ControlResponse, DetectedPr, EffortLevel, ExternalSessionPage, ProviderQuota, SessionOptions,
};
use mainframe_types::background_task::{
    BackgroundTask, derive_background_activity, to_activity_task,
};
use mainframe_types::chat::{
    Chat, ChatMessage, ChatMessageType, DisplayStatus, MessageContent, ProcessState, Project,
    QueuedMessageRef, TodoItem,
};
use mainframe_types::content::LeafContent;
use mainframe_types::context::{SessionContext, SessionMention, SkillFileEntry};
use mainframe_types::display::ChatHistoryPayload;
use mainframe_types::display::{DisplayMessage, ToolCategories};
use mainframe_types::events::DaemonEvent;
use mainframe_types::settings::ExecutionMode;
use tracing::info;

use crate::config_manager::{ChatConfigManager, ChatFieldUpdate, ConfigError, ConfigManagerDeps};
use crate::degraded_recovery::{DegradedRecoveryDeps, DegradedRecoveryError, RecoverySync};
use crate::event_handler::{EventChatUpdate, EventHandler, EventHandlerDeps, PushOut};
use crate::external_session_service::{ExternalSessionDeps, ExternalSessionService};
use crate::lifecycle_manager::{
    ChatLifecycleManager, LifecycleChatUpdate, LifecycleError, LifecycleManagerDeps,
};
use crate::message_cache::MessageCache;
use crate::message_markers::visible_message_text;
use crate::permission_handler::{ChatPermissionHandler, PermissionError, PermissionHandlerDeps};
use crate::permission_manager::PermissionManager;
use crate::plan_mode_actions::{ChatPlanModeCtx, PlanHost};
use crate::plan_mode_handler::PlanModeHandler;
use crate::title_generator::derive_title_from_message;
use crate::transcript_presence::TranscriptPresenceDeps;
use crate::types::ActiveChat;
use crate::worktree_offer::{OfferError, WorktreeOfferDeps, WorktreeOfferRegistry};
use mainframe_types::worktree_offer::WorktreeSwitchOffer;

mod construct;
mod deps;
mod deps_config;
mod deps_event;
mod deps_lifecycle;
mod deps_offer;
mod deps_permission;
mod deps_recovery;
mod errors;
mod external_facade;
mod lifecycle_api;
mod reads;
mod send;
mod shared;
mod update;

pub use deps::ChatManagerDeps;
use deps_config::CmDeps;
use deps_event::EhDeps;
use deps_lifecycle::LcDeps;
use deps_permission::PhDeps;
pub use errors::{ChatFieldsPartial, CommandMeta, ForkError, SendError, TrustWorkspaceError};
pub use external_facade::ExternalSessionFacade;
pub use update::{ChatUpdate, ProcessedAttachments};
// `enrich_chat`/`is_working` are re-imported here (not just via shared's own
// `use super::*`) because their current callers (get_chat/list_chats/
// is_chat_working) still live in this root file — group 2's split moves them
// to `reads.rs`/`construct.rs`, at which point this import becomes unused and
// should be dropped per the plan's rule 5.
use shared::{
    apply_tuning_impl, build_history_session, clear_all_queued_for_chat, enrich_and_emit,
    enrich_chat, handle_queued_processed, is_working, now_ms, queued_for_chat, remap_history,
};

type Registry = Arc<DashMap<String, Arc<Mutex<ActiveChat>>>>;
type QueuedRefs = Arc<Mutex<HashMap<String, QueuedMessageRef>>>;

// ── ChatManager facade ───────────────────────────────────────────────────────

pub struct ChatManager {
    deps: Arc<dyn ChatManagerDeps>,
    active_chats: Registry,
    messages: Arc<Mutex<MessageCache>>,
    permissions: Arc<Mutex<PermissionManager>>,
    queued_refs: QueuedRefs,
    event_handler: Arc<EventHandler<EhDeps>>,
    lifecycle: Arc<ChatLifecycleManager<LcDeps>>,
    permission_handler: ChatPermissionHandler<PhDeps>,
    config: ChatConfigManager<CmDeps>,
    idle_scanner: Mutex<crate::idle_scanner::IdleSessionScanner>,
    external_sessions: Option<Arc<dyn ExternalSessionFacade>>,
    worktree_offers: Arc<WorktreeOfferRegistry>,
    self_ref: Arc<std::sync::OnceLock<std::sync::Weak<ChatManager>>>,
}

impl ChatManager {
    // ── history + context reads ──────────────────────────────────────────────

    /// Cached messages, falling back to a one-shot on-disk history load (Claude
    /// `--resume` JSONL). The load remaps the embedded Claude sessionId back to the
    /// Mainframe chatId and restores any pending permission from history.
    pub async fn get_messages(&self, chat_id: &str) -> Vec<ChatMessage> {
        self.lifecycle.await_loading(chat_id).await;

        let cached = self
            .messages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(chat_id)
            .cloned();
        if let Some(cached) = cached
            && !cached.is_empty()
        {
            return cached;
        }

        let Some(session) = self.history_session(chat_id) else {
            return Vec::new();
        };
        match session.load_history().await {
            Ok(history) => {
                let remapped = remap_history(history, chat_id);
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
                remapped
            }
            Err(_) => Vec::new(),
        }
    }

    /// Load messages from disk, bypassing the in-memory cache (session-files route
    /// needs subagent file changes absent from the cache during an active session).
    pub async fn get_messages_from_disk(&self, chat_id: &str) -> Vec<ChatMessage> {
        let Some(session) = self.history_session(chat_id) else {
            return Vec::new();
        };
        match session.load_history().await {
            Ok(history) => remap_history(history, chat_id),
            Err(err) => {
                tracing::warn!(?err, chat_id, "getMessagesFromDisk failed");
                Vec::new()
            }
        }
    }

    /// Display history + transcript presence in one typed result, so the REST
    /// route (and the UI) can tell an empty thread from a deleted transcript.
    /// Reconciling here persists flag flips and broadcasts `chat.updated`.
    pub async fn get_display_messages(&self, chat_id: &str) -> ChatHistoryPayload {
        let raw = self.get_messages(chat_id).await;
        let categories = self.deps.get_tool_categories(chat_id);
        let messages = self
            .deps
            .prepare_messages_for_client(&raw, categories.as_ref());
        let transcript_missing = match self.get_chat(chat_id) {
            Some(mut chat) => self.reconcile_transcript(&mut chat).await,
            None => false,
        };
        ChatHistoryPayload {
            messages,
            transcript_missing,
            workflow_runs: Vec::new(),
        }
    }

    /// Reconcile the persisted `transcriptMissing` flag against the transcript file
    /// on disk.
    pub async fn reconcile_transcript(&self, chat: &mut Chat) -> bool {
        let wrapper = self.recovery_wrapper();
        crate::transcript_presence::reconcile_transcript_presence(&wrapper, chat).await
    }

    /// Forget the dead CLI session so the next send spawns fresh in the same chat row.
    pub async fn continue_here(&self, chat_id: &str) -> Result<(), DegradedRecoveryError> {
        let wrapper = self.recovery_wrapper();
        crate::degraded_recovery::continue_here(&wrapper, chat_id).await
    }

    /// Detach the chat from its deleted worktree and rebind it to the project root.
    pub async fn continue_in_project_root(
        &self,
        chat_id: &str,
    ) -> Result<(), DegradedRecoveryError> {
        let wrapper = self.recovery_wrapper();
        crate::degraded_recovery::continue_in_project_root(&wrapper, chat_id).await
    }

    /// Re-add the deleted worktree at its stored path from the stored branch (409 when branch gone).
    pub async fn recreate_worktree(&self, chat_id: &str) -> Result<(), DegradedRecoveryError> {
        let wrapper = self.recovery_wrapper();
        crate::degraded_recovery::recreate_chat_worktree(&wrapper, chat_id).await
    }

    /// Build a stateless history-load session for `chat_id`, or `None` when the chat
    /// has no Claude session / adapter / project. Mirrors `getMessages`'s guard chain.
    fn history_session(&self, chat_id: &str) -> Option<Arc<dyn AdapterSession>> {
        let chat = self.get_chat(chat_id)?;
        build_history_session(&self.deps, &chat, chat_id)
    }

    pub async fn get_session_context(&self, chat_id: &str, project_path: &str) -> SessionContext {
        let session = self.get_session_for_chat(chat_id);
        let adapter_id = self.get_chat(chat_id).map(|c| c.adapter_id);
        self.deps
            .get_session_context(chat_id, project_path, session, adapter_id)
            .await
    }

    // ── config + worktree delegations ────────────────────────────────────────

    pub async fn update_chat_config(
        &self,
        chat_id: &str,
        adapter_id: Option<String>,
        model: Option<String>,
        permission_mode: Option<ExecutionMode>,
        plan_mode: Option<bool>,
    ) -> Result<(), ConfigError> {
        self.config
            .update_chat_config(chat_id, adapter_id, model, permission_mode, plan_mode)
            .await
    }

    /// Every worktree rebind below stops and restarts the CLI, so each refuses
    /// while a turn is in flight rather than cutting the answer off.
    pub async fn enable_worktree(
        &self,
        chat_id: &str,
        base_branch: &str,
        branch_name: &str,
    ) -> Result<(), ConfigError> {
        if self.is_chat_working(chat_id) {
            return Err(ConfigError::ChatBusy);
        }
        self.config
            .enable_worktree(chat_id, base_branch, branch_name)
            .await
    }

    pub async fn attach_worktree(
        &self,
        chat_id: &str,
        worktree_path: &str,
        branch_name: Option<&str>,
    ) -> Result<(), ConfigError> {
        if self.is_chat_working(chat_id) {
            return Err(ConfigError::ChatBusy);
        }
        self.config
            .attach_worktree(chat_id, worktree_path, branch_name)
            .await
    }

    pub fn worktree_offers_for_chat(&self, chat_id: &str) -> Vec<WorktreeSwitchOffer> {
        self.worktree_offers.snapshot(chat_id)
    }

    pub fn dismiss_worktree_offer(
        &self,
        chat_id: &str,
        worktree_path: &str,
    ) -> Result<(), OfferError> {
        self.worktree_offers.dismiss(chat_id, worktree_path)
    }

    /// Claims the one switch slot, rebinds, then releases it. The `resolved`
    /// event comes from `on_binding_changed`, never from here.
    pub async fn accept_worktree_offer(
        &self,
        chat_id: &str,
        worktree_path: &str,
    ) -> Result<(), OfferError> {
        // The rebind restarts the CLI, which would kill a turn mid-answer and
        // lose whatever it had not written yet. The offer keeps.
        if self.is_chat_working(chat_id) {
            return Err(OfferError::ChatBusy);
        }
        let offer = self.worktree_offers.claim_accept(chat_id, worktree_path)?;

        if tokio::fs::metadata(worktree_path).await.is_err() {
            self.worktree_offers.release_accept(chat_id);
            self.worktree_offers.expire(chat_id, worktree_path);
            return Err(OfferError::Vanished);
        }

        let result = self
            .config
            .attach_worktree(chat_id, worktree_path, offer.branch_name.as_deref())
            .await;
        self.worktree_offers.release_accept(chat_id);
        result.map_err(|err| OfferError::Message(err.to_string()))
    }

    pub async fn disable_worktree(&self, chat_id: &str) -> Result<(), ConfigError> {
        if self.is_chat_working(chat_id) {
            return Err(ConfigError::ChatBusy);
        }
        self.config.disable_worktree(chat_id).await
    }

    /// Fork the chat's history into a fresh worktree-backed chat. The lifecycle
    /// creates the new (active) chat; the config manager then enables the worktree
    /// on it — mirrors the TS `forkToWorktree(..., enableWorktreeFn)` callback.
    pub async fn fork_to_worktree(
        &self,
        chat_id: &str,
        base_branch: &str,
        branch_name: &str,
    ) -> Result<String, ForkError> {
        let new_chat_id = self
            .lifecycle
            .fork_to_worktree(chat_id, base_branch, branch_name)
            .await?;
        self.config
            .enable_worktree(&new_chat_id, base_branch, branch_name)
            .await?;
        Ok(new_chat_id)
    }

    /// Remove a project and all its chats' live resources.
    pub async fn remove_project(&self, project_id: &str) -> Result<(), String> {
        let chats = self.deps.chats_list(project_id);
        for chat in chats {
            let cell = self.get_active(&chat.id);
            let session = cell
                .as_ref()
                .and_then(|c| c.lock().unwrap_or_else(|e| e.into_inner()).session.clone());
            self.deps
                .kill_tasks_for_chat(&chat.id, chat.worktree_path.clone(), session.clone())
                .await;
            if let Some(session) = &session
                && let Err(err) = session.kill().await
            {
                tracing::warn!(
                    ?err,
                    chat_id = chat.id,
                    "session.kill failed on project removal"
                );
            }
            self.active_chats.remove(&chat.id);
            self.messages
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .delete(&chat.id);
            self.permissions
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .forget(&chat.id);
            self.deps.tracker_remove_chat(&chat.id);
            self.event_handler.clear_display_cache(&chat.id);
        }
        self.deps.projects_remove(project_id)?;
        info!(project_id, "project removed");
        Ok(())
    }

    // ── the message send path + CLI-owned queue ──────────────────────────────

    pub async fn send_message(
        &self,
        chat_id: &str,
        content: &str,
        attachment_ids: Option<&[String]>,
        command: Option<CommandMeta>,
    ) -> Result<(), SendError> {
        let chat = self.get_chat(chat_id);
        if let Some(chat) = &chat
            && chat.worktree_missing == Some(true)
        {
            let error_msg = self.messages.lock().unwrap_or_else(|e| e.into_inner())
                .create_transient_message(
                    chat_id,
                    ChatMessageType::Error,
                    vec![MessageContent::Node(mainframe_types::chat::MessageContentNode::Error {
                        message: format!(
                            "Worktree directory no longer exists: {}. Archive this session or recreate the worktree.",
                            chat.worktree_path.as_deref().unwrap_or_default()
                        ),
                        parent_tool_use_id: None,
                    })],
                    None,
                );
            self.messages
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .append(chat_id, error_msg.clone());
            self.emit(DaemonEvent::MessageAdded {
                chat_id: chat_id.to_string(),
                message: error_msg,
            });
            self.event_handler.emit_display(chat_id);
            return Ok(());
        }

        // Transcript gone + no live CLI: `--resume` would target a dead session id.
        // Apply the same reset as the card's "Continue here" so this send spawns fresh.
        let transcript_missing = chat
            .as_ref()
            .and_then(|c| c.transcript_missing)
            .unwrap_or(false);
        let spawned_now = self
            .get_active(chat_id)
            .map(|c| {
                c.lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .session
                    .as_ref()
                    .is_some_and(|s| s.is_spawned())
            })
            .unwrap_or(false);
        if transcript_missing && !spawned_now {
            self.continue_here(chat_id)
                .await
                .map_err(|e| SendError(e.to_string()))?;
        }

        self.lifecycle.wait_for_interrupt(chat_id).await;

        let spawned = self
            .get_active(chat_id)
            .map(|c| {
                c.lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .session
                    .as_ref()
                    .is_some_and(|s| s.is_spawned())
            })
            .unwrap_or(false);
        if !spawned {
            self.lifecycle.start_chat(chat_id).await;
        }

        let post = self
            .get_active(chat_id)
            .ok_or_else(|| SendError(format!("Chat {chat_id} not running")))?;
        let session = {
            let guard = post.lock().unwrap_or_else(|e| e.into_inner());
            match guard.session.clone() {
                Some(s) if s.is_spawned() => s,
                _ => return Err(SendError(format!("Chat {chat_id} not running"))),
            }
        };
        info!(chat_id, "user message sent");

        // Stamp turn start right before dispatch (for onResult turnDurationMs).
        post.lock()
            .unwrap_or_else(|e| e.into_inner())
            .turn_started_at = Some(now_ms());

        if let Some(cmd) = command {
            return self
                .dispatch_command(cmd, &post, &session, chat_id, content)
                .await;
        }
        self.send_plain_text(&post, &session, chat_id, content, attachment_ids)
            .await
    }

    fn set_working(&self, cell: &Arc<Mutex<ActiveChat>>, chat_id: &str, now: &str) {
        {
            let mut guard = cell.lock().unwrap_or_else(|e| e.into_inner());
            guard.chat.process_state = Some(Some(ProcessState::Working));
            guard.chat.updated_at = now.to_string();
        }
        self.deps.chats_update(
            chat_id,
            &ChatUpdate {
                process_state: Some(Some(ProcessState::Working)),
                updated_at: Some(now.to_string()),
                ..Default::default()
            },
        );
    }

    pub async fn edit_queued_message(
        &self,
        chat_id: &str,
        message_id: &str,
        content: &str,
    ) -> Result<(), SendError> {
        let r = self.find_ref(chat_id, message_id);
        let Some(r) = r else {
            return Ok(());
        };
        let Some(session) = self.get_session_for_chat(chat_id) else {
            return Ok(());
        };

        let cancelled = session.cancel_queued_message(r.uuid.clone()).await?;
        if !cancelled {
            info!(
                chat_id,
                uuid = r.uuid,
                "edit lost race: original already dequeued by CLI"
            );
            return Ok(());
        }

        self.queued_refs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&r.uuid);
        self.emit(DaemonEvent::MessageQueuedCancelled {
            chat_id: chat_id.to_string(),
            uuid: r.uuid.clone(),
        });
        self.messages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove_by_id(chat_id, &r.message_id);
        self.event_handler.emit_display(chat_id);

        self.send_message(chat_id, content, r.attachment_ids.as_deref(), None)
            .await
    }

    pub async fn cancel_queued_message(
        &self,
        chat_id: &str,
        message_id: &str,
    ) -> Result<(), SendError> {
        let r = self.find_ref(chat_id, message_id);
        let Some(r) = r else {
            return Ok(());
        };
        let Some(session) = self.get_session_for_chat(chat_id) else {
            return Ok(());
        };

        let cancelled = session.cancel_queued_message(r.uuid.clone()).await?;
        if !cancelled {
            info!(
                chat_id,
                uuid = r.uuid,
                "cancel lost race: message already dequeued by CLI"
            );
            return Ok(());
        }

        self.queued_refs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&r.uuid);
        self.messages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove_by_id(chat_id, &r.message_id);
        self.emit(DaemonEvent::MessageQueuedCancelled {
            chat_id: chat_id.to_string(),
            uuid: r.uuid.clone(),
        });
        self.event_handler.emit_display(chat_id);
        info!(chat_id, uuid = r.uuid, "queued message cancelled in CLI");
        Ok(())
    }

    fn find_ref(&self, chat_id: &str, message_id: &str) -> Option<QueuedMessageRef> {
        self.queued_refs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .find(|r| r.chat_id == chat_id && r.message_id == message_id)
            .cloned()
    }
}

#[cfg(test)]
pub(crate) mod tests;

// PORT STATUS: src/chat/chat-manager.ts (787 lines)
// confidence: medium
// notes: The TS closure-over-`this` wiring → concrete delegating Deps wrappers
// notes: (EhDeps/LcDeps/PhDeps/CmDeps) that share ONE `Arc<dyn ChatManagerDeps>` + the
// notes: shared PER_ENTITY caches (`Arc<Mutex<MessageCache/PermissionManager>>`,
// notes: `Arc<DashMap<_, Arc<Mutex<ActiveChat>>>>`, `Arc<Mutex<HashMap<uuid,ref>>>`).
// notes: `emitEvent`'s enrich-on-emit (displayStatus/isRunning/worktreeMissing) is a
// notes: shared `enrich_and_emit` the wrappers + facade both call; `deps.emit_event`
// notes: is the RAW onEvent. sendMessage + CLI-owned queue + command routing ported
// notes: 1:1; queuedRefs keyed by uuid, filtered by chatId (per CONCURRENCY.tsv 72).
// notes: Task 5.4 completed the deferred facade surface: list_filtered / getEffective/
// notes: Project/ChatProjectId reads (enriched); sync_chat_tags/fields + emitChatUpdated
// notes: + notifyWorktreeDeleted broadcasts; applyTuning (live re-apply); getMessages/
// notes: getMessagesFromDisk/getDisplayMessages (loadHistory via create_session dep +
// notes: cache/permission-restore); getSessionContext + addMention (context-tracker via
// notes: the injected get_session_context/chats_add_mention deps); updateChatConfig /
// notes: enable/attach/disable/forkToWorktree (CmDeps wires ChatConfigManager;
// notes: forkToWorktree = lifecycle.fork_to_worktree + config.enable_worktree). PhDeps
// notes: get_messages now shares build_history_session, so getPendingPermission's JSONL
// notes: restore is real. applyTuning skips the TS `if (!session.applyTuning)` capability
// notes: guard (Rust default apply_tuning is Ok no-op) → an extra resolve for adapters
// notes: without live tuning; behaviourally faithful. trustWorkspace is now ported:
// notes: chats_get + projects_get_path (both pre-existing deps) resolve
// notes: `chat.worktreePath ?? project.path`, then the new injected
// notes: `write_workspace_trust` deps hook (mainframe-adapter-claude::trust_store,
// notes: wired in chat_deps.rs) persists it — 404/500 semantics match the TS route's
// notes: try/catch. getExternalSessionService(): `ExternalSessionService<D>` is generic
// notes: over the concrete deps type, but `new()` only ever receives the already-erased
// notes: `Arc<dyn ChatManagerDeps>` — so the object-safe `ExternalSessionFacade` trait
// notes: (BoxFuture-based) is blanket-impl'd for `ExternalSessionService<D>` and injected
// notes: post-construction via `with_external_sessions` from `build_chat_manager`, where
// notes: the concrete `DaemonChatDeps` Arc still exists. `None` (no service) is a legal
// notes: state for harnesses that only need the rest of the facade. STILL DEFERRED
// notes: (genuine blocker, not on this task's crate surface): plan-mode delegation
// notes: (PhDeps createPlanModeHandler seam).
// notes: setStopLaunchProcesses/setPushService are construction-time injection in Rust
// notes: (LaunchStopper + send_push deps), so the TS late-bind setters are unnecessary.
// notes: Ported tests: cli-queue (5), recover-working (5), turn-timing (1), command-
// notes: routing (7), remove-project-kills-tasks (1), + 5.4 facade cases (5).
// notes: Main catch-up (#423/#424/#425): enrichChat widens `working` via
// notes: `tracker.listLive` + sets `backgroundActivity` (F); getDisplayMessages returns
// notes: `ChatHistoryPayload` and reconciles transcript presence (E); reconcile_transcript
// notes: / continue_here / continue_in_project_root / recreate_worktree delegate to the
// notes: transcript_presence + degraded_recovery modules via a `RecoveryWrapper` that
// notes: implements both deps traits over the shared internals (chat lock is a leaf,
// notes: emit-after-drop); sendMessage auto-`continueHere` when transcriptMissing && not
// notes: spawned. No defaulted ChatManagerDeps method is left silently unoverridden in
// notes: chat_deps.rs: tracker_list_live, tracker_end_all_running, is_transcript_present
// notes: and adapter_snapshot_models are all required, not defaulted (#273 for the
// notes: tracker methods — a silent default caused backgroundActivity to stay empty,
// notes: then let orphaned tasks stay Running forever, in production; #289 for
// notes: is_transcript_present — a silent default left transcript-presence
// notes: reconciliation permanently inert in production; #290 for
// notes: adapter_snapshot_models — a silent default made
// notes: normalize_saved_default_model's probe-failure short-circuit fire on every
// notes: chat creation, leaking a retired saved default into new chats);
// notes: generate_title gained an adapter_id arg (adapter-aware).
// notes: Ported: chat-manager-background-activity (5, via direct enrich_chat); the
// notes: production wiring is covered by mainframe-server's chat_background_activity
// notes: integration test (#273). Also chat-manager-degraded (3).
// todos: 1
