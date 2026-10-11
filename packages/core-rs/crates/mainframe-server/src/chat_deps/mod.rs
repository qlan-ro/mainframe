//! Production chat capabilities and their daemon collaborators.

use mainframe_chat::chat_manager::{
    AdapterPort, ChatStore, EventEmitter, ProjectPaths, Pusher, WorkspacePort,
};

use mainframe_chat::segments::categories::{segment_adapters, union_categories};
use std::sync::Arc;

use mainframe_adapter_api::pr_detection::scan_history_for_prs;
use mainframe_adapter_api::{
    AdapterError, AdapterRegistry, AdapterSession, BoxFuture, ForkPinError, ForkPinRequest,
    PlanModeActionHandler,
};
use mainframe_adapter_claude::external_session_cache::{
    ExternalSessionCache, new_external_session_cache,
};
use mainframe_adapter_claude::external_sessions::ExternalSessionListOpts;
use mainframe_adapter_claude::messages::display_pipeline::prepare_messages_for_client;
use mainframe_adapter_claude::messages::message_parsing::strip_mainframe_command_tags;
use mainframe_background_tasks::kill::{KillTasksForChatArgs, SessionLike, kill_tasks_for_chat};
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_chat::attachment_processor;
use mainframe_chat::chat_manager::{
    AdapterForkInfo, ChatManager, ChatManagerDeps, ForkCreateInput, ProcessedAttachments,
};
use mainframe_chat::context_tracker::{
    AttachmentLister, ContextDb, extract_mentions_from_text, get_session_context,
};
use mainframe_chat::event_handler::PushOut;
use mainframe_chat::external_session_service::ExternalSessionDeps;
use mainframe_chat::fork::PendingForkState;
use mainframe_chat::resolve_tuning_for_chat::resolve_tuning_for_chat;
use mainframe_claude_workflows::store::ClaudeWorkflowStore;
use mainframe_services::attachment::AttachmentStore;
use mainframe_services::attachment::attachment_store::AttachmentKind;
use mainframe_services::notifications::should_notify_permission;
use mainframe_services::push::PushService;
use mainframe_services::push::push_service::{PushMessage, PushPriority};
use mainframe_services::quota::{IngestMode, QuotaManager};
use mainframe_types::adapter::{DetectedPr, ExternalSessionPage, ProviderQuota, SessionOptions};
use mainframe_types::background_task::BackgroundTask;
use mainframe_types::chat::{
    Chat, ChatMessage, ChatMessageType, MessageContent, NewChat, ResolvedTuning, TodoItem,
};
use mainframe_types::chat_patch::ChatPatch;
use mainframe_types::content::LeafContent;
use mainframe_types::context::{
    SessionAttachment, SessionAttachmentKind, SessionMention, SkillFileEntry,
};
use mainframe_types::display::{DisplayMessage, ToolCategories};
use mainframe_types::events::DaemonEvent;
use mainframe_types::seam_error::SeamError;
use mainframe_types::settings_kv::SettingsKv;
use tokio::sync::broadcast;

use crate::chat_seams::{LaunchStopper, ScopeTunnelStopper};
use crate::ctx::GitFactory;
use crate::db::{Db, notification_config};

/// The daemon-side `ChatManagerDeps`. Cheap to clone-share (every field is an
/// `Arc`/handle), constructed once at boot in [`build_chat_manager`].
pub struct DaemonChatDeps {
    db: Db,
    adapters: Arc<AdapterRegistry>,
    background_tasks: Arc<BackgroundTaskTracker>,
    attachments: Arc<AttachmentStore>,
    push: Arc<PushService>,
    git: GitFactory,
    broadcast: broadcast::Sender<DaemonEvent>,
    launch: Arc<dyn LaunchStopper>,
    scope_tunnels: Arc<dyn ScopeTunnelStopper>,
    quota: Arc<QuotaManager>,
    /// Process-lifetime Claude external-session enrichment cache — owned here
    /// (not a module-level singleton) and threaded into every
    /// `list_external_sessions("claude", ...)` call.
    claude_external_session_cache: ExternalSessionCache,
    /// Shared with `AppCtx` and the `ClaudeAdapter` — the daemon's single
    /// per-chat workflow-run store (the CLI-exit sweep's target).
    claude_workflows: Arc<ClaudeWorkflowStore>,
    /// The daemon's data directory (`AppCtx::data_dir`). A non-project chat's
    /// scratch cwd is `<data_dir>/scratch/<chatId>`, `fork_snapshots_dir`
    /// joins `"fork-snapshots"` onto it, and `history_cache_dir` joins
    /// `"cache/history"` onto it (the history snapshot cache's cold-load
    /// shortcut). Threaded in rather than read via
    /// `mainframe_runtime::config::get_data_dir()` at request time: that
    /// helper does synchronous I/O, which a request-path deps method must
    /// not do.
    data_dir: std::path::PathBuf,
}

impl ChatManagerDeps for DaemonChatDeps {
    fn settings(&self) -> &dyn SettingsKv {
        &self.db
    }
}

mod adapters;
mod bridges;
mod build;
mod external_sessions;
mod scan;
#[path = "../chat_deps_segments.rs"]
mod segments;
mod store;
mod workspace;
use bridges::{AttachmentListerHandle, CtxDbHandle};
pub use build::{ChatManagerParams, build_chat_manager};
#[cfg(test)]
use scan::scan_history_for_mentions;
#[cfg(test)]
mod tests;
