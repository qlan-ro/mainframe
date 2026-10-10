//! `ChatManager` owns the message cache, permissions, active-chat registry, and
//! queued refs. It keeps the shared per-chat caches behind `Arc<Mutex<..>>` /
//! `Arc<DashMap<..>>` and wires the sub-managers with concrete delegating `Deps`
//! wrappers (`EhDeps`/`LcDeps`/`PhDeps`) that all hold the SAME
//! `Arc<dyn ChatManagerDeps>` + shared state. Non-generic (`dyn ChatManagerDeps`)
//! to avoid generic self-recursion in the wiring.
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
    AdapterError, AdapterSession, BoxFuture, ForkPinError, ForkPinRequest, ImageInput,
    PlanModeActionHandler, SessionSink,
};
use mainframe_services::commands::{find_mainframe_command, wrap_mainframe_command};
use mainframe_services::workspace::is_worktree_present;
use mainframe_services::workspace::worktree::is_directory_present;
use mainframe_types::adapter::{
    ControlResponse, DetectedPr, EffortLevel, ExternalSessionPage, ForkSource, ProviderQuota,
    SessionOptions,
};
use mainframe_types::background_task::{
    BackgroundTask, derive_background_activity, to_activity_task,
};
use mainframe_types::chat::{
    Chat, ChatMessage, ChatMessageType, ChatStatus, DisplayStatus, MessageContent, NewChat,
    ProcessState, Project, QueuedMessageRef, TodoItem,
};
use mainframe_types::content::LeafContent;
use mainframe_types::context::{SessionContext, SessionMention, SkillFileEntry};
use mainframe_types::display::ChatHistoryPayload;
use mainframe_types::display::{DisplayMessage, ToolCategories};
use mainframe_types::events::DaemonEvent;
use mainframe_types::settings::ExecutionMode;
use mainframe_types::time::now_iso8601;
use tracing::info;

use delivery::Delivery;

use crate::config_manager::{ChatConfigManager, ChatFieldUpdate, ConfigError, ConfigManagerDeps};
use crate::degraded_recovery::{DegradedRecoveryDeps, DegradedRecoveryError, RecoverySync};
use crate::event_handler::{EventChatUpdate, EventHandler, EventHandlerDeps, PushOut};
use crate::external_session_service::{ExternalSessionDeps, ExternalSessionService};
use crate::fork::{PendingForkState, fork_title};
use crate::history_cache::{HistoryFingerprint, HistorySnapshotCache};
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
mod delivery;
mod deps;
mod deps_config;
mod deps_event;
mod deps_lifecycle;
mod deps_offer;
mod deps_permission;
mod deps_recovery;
mod discard;
mod enrich;
mod errors;
mod external_facade;
mod fork_api;
mod fork_sweep;
mod handoff_locks;
mod handoff_resolve;
mod handoff_send;
mod history;
mod lifecycle_api;
mod reads;
mod send;
mod send_entry;
mod send_queue;
mod shared;
mod side_chat;
mod steer;
mod switch_api;
mod update;

pub use deps::ChatManagerDeps;
pub use errors::{ChatFieldsPartial, CommandMeta, ForkError, SendError, TrustWorkspaceError};
pub use external_facade::ExternalSessionFacade;
pub use history::ResumeSnapshot;
pub(crate) use shared::remap_history as remap_history_for;
pub use side_chat::OpenSideChatError;
pub use update::{ChatUpdate, ProcessedAttachments};

// `ForkChatError` (the fork-a-chat action, `fork_api.rs`) is distinct from
// `ForkError` above (the `fork_to_worktree` action).
pub use crate::fork::{AdapterForkInfo, ForkChatError, ForkCreateInput, ForkPoint};

use deps_config::CmDeps;
use deps_event::EhDeps;
use deps_lifecycle::LcDeps;
use deps_permission::PhDeps;
use deps_recovery::PresenceDeps;
use enrich::Enricher;
// `enrich_chat`/`is_working` have no direct caller left in this file — every
// caller (enrich.rs, construct.rs) reaches them through this re-import via its
// own `use super::*`, so removing this line would break the glob for them.
use shared::{
    apply_tuning_impl, build_history_session, clear_all_queued_for_chat, enrich_chat,
    handle_queued_processed, is_working, now_ms, queued_for_chat, remap_history,
};
use side_chat::is_side_chat;

type Registry = Arc<DashMap<String, Arc<Mutex<ActiveChat>>>>;
/// Insertion-ordered (FIFO): `queue_state` snapshots render in the order we
/// iterate, so enqueue order IS the wire contract. Queues are tiny (a few
/// prompts), so linear scans by uuid beat carrying an ordered-map dependency.
type QueuedRefs = Arc<Mutex<Vec<QueuedMessageRef>>>;

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
    /// Persistent cold-load shortcut for `load_history_into_cache`
    /// (`history.rs`, `history_cache.rs`) — distinct from `messages` (the
    /// in-memory per-chat cache above), which stays the source of truth for
    /// any chat that's actually hot.
    history_cache: Arc<HistorySnapshotCache>,
    /// Every derived `Chat` field, for reads and emits alike.
    enricher: Enricher,
    /// One lock per chat, held across `prepare_handoff`'s check-then-insert
    /// (`handoff_send.rs`), so two sends racing for the same chat cannot
    /// both build and record a handoff.
    handoff_locks: handoff_locks::HandoffLocks,
    teardown: Arc<crate::chat_teardown::ChatTeardown<EhDeps>>,
}

#[cfg(test)]
pub(crate) mod tests;
