//! The daemon WebSocket wire contract: `DaemonEvent` (server→client) and
//! `ClientEvent` (client→server). Both are internally tagged on `type`; tag
//! values are copied verbatim (dotted / colon-delimited) via per-variant
//! `#[serde(rename = ...)]`, and struct-variant fields are camelCased via
//! `rename_all_fields`. The chat transcript/gate dialect that used to live
//! here (`display.message.*`, `message.added`/`.updated`, `permission.*`,
//! `message.send`, `permission.respond`) is retired — the ACP facade
//! (`crate::acp`, `/acp/{profile}`) is the only chat wire protocol.

use serde::{Deserialize, Serialize};

use crate::adapter::{
    AdapterCapabilities, AdapterModel, AdapterProcess, DetectedPr, ProviderQuota,
};
use crate::automation::{
    AutomationCompletedStatus, AutomationInteractionSummary, AutomationNotificationLinks,
    AutomationRunSummary,
};
use crate::background_task::BackgroundTask;
use crate::chat::{Chat, TodoItem};
use crate::claude_workflow::ClaudeWorkflowRun;
use crate::cli_update::ProviderCliStatus;
use crate::launch::LaunchProcessStatus;
use crate::plugin::UiZone;
use crate::worktree_offer::{WorktreeOfferOutcome, WorktreeSwitchOffer};

mod payload;
pub use payload::*;

// ─── DaemonEvent (server→client) ─────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum DaemonEvent {
    #[serde(rename = "connection.ready")]
    ConnectionReady { client_id: String },
    #[serde(rename = "chat.created")]
    ChatCreated {
        chat: Chat,
        #[serde(skip_serializing_if = "Option::is_none")]
        source: Option<ChatCreatedSource>,
    },
    #[serde(rename = "chat.updated")]
    ChatUpdated {
        chat: Chat,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<ChatUpdatedReason>,
    },
    #[serde(rename = "chat.ended")]
    ChatEnded { chat_id: String },
    /// Idle whole-chat offload: the daemon released the chat's CLI
    /// process, cached history, and registry cell as one unit. Connection-global
    /// (see `DaemonEvent::is_connection_global`) so a
    /// client reaches every subscriber, not only one subscribed to this chat.
    #[serde(rename = "chat.offloaded")]
    ChatOffloaded { chat_id: String },
    /// A delegated task's status, work state, or delivery changed. Carries no
    /// top-level `chatId`, so every client sees it (a parent's row and its
    /// tasks chip update without subscribing to the child).
    #[serde(rename = "delegated_task.updated")]
    DelegatedTaskUpdated {
        task: crate::orchestration::DelegatedTask,
    },
    #[serde(rename = "process.started")]
    ProcessStarted {
        chat_id: String,
        process: AdapterProcess,
    },
    #[serde(rename = "process.ready")]
    ProcessReady {
        process_id: String,
        #[serde(rename = "claudeSessionId")]
        vendor_session_id: String,
    },
    #[serde(rename = "process.stopped")]
    ProcessStopped { process_id: String },
    #[serde(rename = "context.updated")]
    ContextUpdated {
        chat_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        file_paths: Option<Vec<String>>,
    },
    #[serde(rename = "error")]
    Error {
        #[serde(skip_serializing_if = "Option::is_none")]
        chat_id: Option<String>,
        error: String,
    },
    #[serde(rename = "plugin.panel.registered")]
    PluginPanelRegistered {
        plugin_id: String,
        panel_id: String,
        zone: UiZone,
        label: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        icon: Option<String>,
    },
    #[serde(rename = "plugin.panel.unregistered")]
    PluginPanelUnregistered {
        plugin_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        panel_id: Option<String>,
    },
    #[serde(rename = "plugin.action.registered")]
    PluginActionRegistered {
        plugin_id: String,
        action_id: String,
        label: String,
        shortcut: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        icon: Option<String>,
    },
    #[serde(rename = "plugin.action.unregistered")]
    PluginActionUnregistered {
        plugin_id: String,
        action_id: String,
    },
    #[serde(rename = "plugin.notification")]
    PluginNotification {
        plugin_id: String,
        title: String,
        body: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        level: Option<String>,
    },
    #[serde(rename = "launch.output")]
    LaunchOutput {
        project_id: String,
        effective_path: String,
        name: String,
        data: String,
        stream: LaunchStream,
    },
    #[serde(rename = "launch.status")]
    LaunchStatus {
        project_id: String,
        effective_path: String,
        name: String,
        status: LaunchProcessStatus,
    },
    #[serde(rename = "launch.tunnel")]
    LaunchTunnel {
        project_id: String,
        effective_path: String,
        name: String,
        url: String,
    },
    #[serde(rename = "launch.tunnel.failed")]
    LaunchTunnelFailed {
        project_id: String,
        effective_path: String,
        name: String,
        error: String,
    },
    #[serde(rename = "launch.port.timeout")]
    LaunchPortTimeout {
        project_id: String,
        effective_path: String,
        name: String,
        port: i64,
    },
    #[serde(rename = "launch.scopeReleased")]
    LaunchScopeReleased {
        project_id: String,
        effective_path: String,
    },
    #[serde(rename = "sessions.external.count")]
    SessionsExternalCount { project_id: String, count: i64 },
    #[serde(rename = "chat.notification")]
    ChatNotification {
        chat_id: String,
        title: String,
        body: String,
        level: ChatNotificationLevel,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        kind: Option<ChatNotificationKind>,
    },
    #[serde(rename = "adapter.models.updated")]
    AdapterModelsUpdated {
        adapter_id: String,
        models: Vec<AdapterModel>,
        models_revision: i64,
        /// The probe's install verdict. Boot serves `/api/adapters` from the
        /// static seed (`installed: false`) when the probe outruns the 2s cap,
        /// so this event is a client's only correction until it reconnects.
        /// Optional on the wire: a client may be talking to a daemon older
        /// than the field, and then keeps the flag it already has.
        #[serde(skip_serializing_if = "Option::is_none")]
        installed: Option<bool>,
        /// The adapter's current capabilities, attached whenever this
        /// event fires — including a fire triggered only by a capability or
        /// `fork_unavailable_reason` change, with no catalog change at all — so a
        /// client sees the freshest known values without waiting for its next
        /// `/api/adapters` poll or reconnect. `None` only when talking to a daemon
        /// older than this field.
        #[serde(skip_serializing_if = "Option::is_none")]
        capabilities: Option<AdapterCapabilities>,
        /// Mirrors `AdapterInfo.fork_unavailable_reason`, attached
        /// under the same "whenever this event fires" rule as `capabilities`.
        #[serde(skip_serializing_if = "Option::is_none")]
        fork_unavailable_reason: Option<String>,
    },
    #[serde(rename = "provider.quota.updated")]
    ProviderQuotaUpdated {
        adapter_id: String,
        quota: ProviderQuota,
    },
    #[serde(rename = "provider.cli.updated")]
    ProviderCliUpdated { status: ProviderCliStatus },
    #[serde(rename = "todos.updated")]
    TodosUpdated {
        chat_id: String,
        todos: Vec<TodoItem>,
    },
    #[serde(rename = "chat.prDetected")]
    ChatPrDetected { chat_id: String, pr: DetectedPr },
    #[serde(rename = "worktree.offer.raised")]
    WorktreeOfferRaised {
        chat_id: String,
        offer: WorktreeSwitchOffer,
    },
    #[serde(rename = "worktree.offer.resolved")]
    WorktreeOfferResolved {
        chat_id: String,
        worktree_path: String,
        outcome: WorktreeOfferOutcome,
    },
    #[serde(rename = "worktree.offer.snapshot")]
    WorktreeOfferSnapshot {
        chat_id: String,
        offers: Vec<WorktreeSwitchOffer>,
    },
    #[serde(rename = "chat.trustRequired")]
    ChatTrustRequired {
        chat_id: String,
        project_path: String,
    },
    #[serde(rename = "tunnel:status")]
    TunnelStatus {
        state: TunnelState,
        label: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        url: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        dns_verified: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    #[serde(rename = "file:changed")]
    FileChanged { path: String },
    #[serde(rename = "subscribe:file:ack")]
    SubscribeFileAck {
        requested_path: String,
        resolved_path: String,
    },
    #[serde(rename = "subscribe:ack")]
    SubscribeAck { chat_id: String },
    #[serde(rename = "background_task.started")]
    BackgroundTaskStarted {
        chat_id: String,
        task: BackgroundTask,
    },
    #[serde(rename = "background_task.updated")]
    BackgroundTaskUpdated {
        chat_id: String,
        task: BackgroundTask,
    },
    #[serde(rename = "background_task.ended")]
    BackgroundTaskEnded {
        chat_id: String,
        task: BackgroundTask,
    },
    /// Carries a Claude CLI `/workflows` run.
    #[serde(rename = "claude_workflow.run.updated")]
    ClaudeWorkflowRunUpdated {
        chat_id: String,
        run: ClaudeWorkflowRun,
    },
    // ── Automations v2 (contract §4 — all five are chatId-less) ─────────────
    /// A6 — emitted on run start, EVERY leaf-step terminal transition, park,
    /// and finalize.
    #[serde(rename = "automation.run.updated")]
    AutomationRunUpdated { run: AutomationRunSummary },
    #[serde(rename = "automation.interaction.created")]
    AutomationInteractionCreated {
        interaction: AutomationInteractionSummary,
    },
    #[serde(rename = "automation.interaction.resolved")]
    AutomationInteractionResolved {
        interaction_id: String,
        run_id: String,
    },
    /// One WS event serves both chaining selectors: the
    /// `automation.finished`/`automation.failed` triggers filter this by
    /// `status` — they are NOT separate events.
    #[serde(rename = "automation.completed")]
    AutomationCompleted {
        automation_id: String,
        automation_name: String,
        run_id: String,
        status: AutomationCompletedStatus,
        result: String,
    },
    #[serde(rename = "automation.notification")]
    AutomationNotification {
        run_id: String,
        automation_id: String,
        title: String,
        body: String,
        links: AutomationNotificationLinks,
    },
    /// A standalone, run-less notification — `POST /api/notifications`.
    /// Distinct from `automation.notification`, whose
    /// `runId`/`automationId` a caller outside a run doesn't have (e.g.
    /// `lane_apply.py`, a plain script posting from loopback).
    #[serde(rename = "notification.created")]
    NotificationCreated {
        title: String,
        body: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        links: Option<NotificationLinks>,
    },
}

// ─── ClientEvent (client→server) ─────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum ClientEvent {
    #[serde(rename = "subscribe")]
    Subscribe { chat_id: String },
    #[serde(rename = "unsubscribe")]
    Unsubscribe { chat_id: String },
    #[serde(rename = "subscribe:file")]
    SubscribeFile {
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        project_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        chat_id: Option<String>,
    },
    #[serde(rename = "unsubscribe:file")]
    UnsubscribeFile {
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        project_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        chat_id: Option<String>,
    },
}

#[cfg(test)]
#[path = "events_tests.rs"]
mod tests;

mod scope;
