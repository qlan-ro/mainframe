//! Ported from `packages/core/src/chat/chat-manager.ts`.
//!
//! The TS `ChatManager` owns `messages`/`permissions`/`activeChats`/`queuedRefs`
//! and wires the sub-managers with closures over `this`. The Rust port keeps the
//! shared PER_ENTITY caches behind `Arc<Mutex<..>>` / `Arc<DashMap<..>>` and wires
//! the sub-managers with concrete delegating `Deps` wrappers (`EhDeps`/`LcDeps`/
//! `PhDeps`) that all hold the SAME `Arc<dyn ChatManagerDeps>` + shared state — the
//! Rust analogue of the TS closure bag. Non-generic (`dyn ChatManagerDeps`) to
//! avoid generic self-recursion in the wiring.
//!
//! The facade itself is split by band across flat submodules (never nested, so
//! every submodule reaches this file's `use` block via `use super::*`): `deps.rs`
//! is the injection surface, each `deps_*.rs` builds and owns one sub-manager
//! collaborator, and `construct.rs`/`reads.rs`/`lifecycle_api.rs`/`history.rs`/
//! `config_api.rs`/`send_entry.rs`/`send.rs` carry `impl ChatManager` by band
//! (construction, registry reads, lifecycle/permission delegations, history,
//! config/worktree delegations, the send-path entry point, and its command
//! helpers).

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

mod config_api;
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
mod history;
mod lifecycle_api;
mod reads;
mod send;
mod send_entry;
mod shared;
mod update;

pub use deps::ChatManagerDeps;
pub use errors::{ChatFieldsPartial, CommandMeta, ForkError, SendError, TrustWorkspaceError};
pub use external_facade::ExternalSessionFacade;
pub use update::{ChatUpdate, ProcessedAttachments};

use deps_config::CmDeps;
use deps_event::EhDeps;
use deps_lifecycle::LcDeps;
use deps_permission::PhDeps;
// `enrich_chat`/`is_working` have no direct caller left in this file — every
// caller (reads.rs, construct.rs) reaches them through this re-import via its
// own `use super::*`, so removing this line would break the glob for them.
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
// notes: #292 split this file into flat submodules under `chat_manager/` (by band:
// notes: construction, deps wiring, registry reads, lifecycle/permission, history,
// notes: config/worktree, send-path) to bring the file and `send_message`/`new`
// notes: under the 300-line/50-line limits. Pure move, no API or behavior change.
// todos: 1
