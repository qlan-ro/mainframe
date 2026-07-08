//! Ported from `packages/types/src/events.ts`.
//!
//! The daemon WebSocket wire contract: `DaemonEvent` (server→client, 54
//! variants) and `ClientEvent` (client→server, 6 variants). Both are internally
//! tagged on `type`; tag values are copied verbatim (dotted / colon-delimited)
//! via per-variant `#[serde(rename = ...)]`, and struct-variant fields are
//! camelCased via `rename_all_fields`. Cross-checked against
//! `docs/rust-port/CONTRACT/ws-events.json`.

use serde::{Deserialize, Serialize};

use crate::adapter::{AdapterModel, AdapterProcess, ControlRequest, ControlResponse, DetectedPr};
use crate::background_task::BackgroundTask;
use crate::chat::{Chat, ChatMessage, QueuedMessageRef, TodoItem};
use crate::display::DisplayMessage;
use crate::launch::LaunchProcessStatus;
use crate::plugin::UiZone;
use crate::workflow::{WorkflowInteractionSummary, WorkflowRunSummary, WorkflowStepStatus};

// ─── Small payload enums (event-local literal unions) ────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatCreatedSource {
    Import,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatUpdatedReason {
    Completed,
    Error,
    Interrupted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LaunchStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatNotificationLevel {
    Success,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TunnelState {
    Starting,
    Ready,
    DnsVerified,
    Error,
    Stopped,
}

/// The `step` payload of `workflow.step.updated` — a TS
/// `Pick<WorkflowStepSummary, 'stepPath'|'stepId'|'status'|'attempt'>`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStepUpdate {
    pub step_path: String,
    pub step_id: Option<String>,
    pub status: WorkflowStepStatus,
    pub attempt: i64,
}

/// Optional per-message metadata carried by `message.send`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageSendMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<MessageSendCommand>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageSendCommand {
    pub name: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<String>,
}

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
    #[serde(rename = "process.started")]
    ProcessStarted {
        chat_id: String,
        process: AdapterProcess,
    },
    #[serde(rename = "process.ready")]
    ProcessReady {
        process_id: String,
        claude_session_id: String,
    },
    #[serde(rename = "process.stopped")]
    ProcessStopped { process_id: String },
    #[serde(rename = "message.added")]
    MessageAdded {
        chat_id: String,
        message: ChatMessage,
    },
    #[serde(rename = "message.updated")]
    MessageUpdated {
        chat_id: String,
        message: ChatMessage,
    },
    #[serde(rename = "display.message.added")]
    DisplayMessageAdded {
        chat_id: String,
        message: DisplayMessage,
    },
    #[serde(rename = "display.message.updated")]
    DisplayMessageUpdated {
        chat_id: String,
        message: DisplayMessage,
    },
    #[serde(rename = "display.messages.set")]
    DisplayMessagesSet {
        chat_id: String,
        messages: Vec<DisplayMessage>,
    },
    #[serde(rename = "messages.cleared")]
    MessagesCleared { chat_id: String },
    #[serde(rename = "permission.requested")]
    PermissionRequested {
        chat_id: String,
        request: ControlRequest,
        notify: bool,
    },
    #[serde(rename = "permission.resolved")]
    PermissionResolved { chat_id: String, request_id: String },
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
    #[serde(rename = "message.queued")]
    MessageQueued {
        chat_id: String,
        r#ref: QueuedMessageRef,
    },
    #[serde(rename = "message.queued.processed")]
    MessageQueuedProcessed { chat_id: String, uuid: String },
    #[serde(rename = "message.queued.cancelled")]
    MessageQueuedCancelled { chat_id: String, uuid: String },
    #[serde(rename = "message.queued.cleared")]
    MessageQueuedCleared { chat_id: String },
    #[serde(rename = "message.queued.snapshot")]
    MessageQueuedSnapshot {
        chat_id: String,
        refs: Vec<QueuedMessageRef>,
    },
    #[serde(rename = "chat.notification")]
    ChatNotification {
        chat_id: String,
        title: String,
        body: String,
        level: ChatNotificationLevel,
    },
    #[serde(rename = "chat.compacting")]
    ChatCompacting { chat_id: String },
    #[serde(rename = "chat.compactDone")]
    ChatCompactDone { chat_id: String },
    #[serde(rename = "chat.contextUsage")]
    ChatContextUsage {
        chat_id: String,
        percentage: f64,
        total_tokens: i64,
        max_tokens: i64,
    },
    #[serde(rename = "adapter.models.updated")]
    AdapterModelsUpdated {
        adapter_id: String,
        models: Vec<AdapterModel>,
        models_revision: i64,
    },
    #[serde(rename = "todos.updated")]
    TodosUpdated {
        chat_id: String,
        todos: Vec<TodoItem>,
    },
    #[serde(rename = "chat.prDetected")]
    ChatPrDetected { chat_id: String, pr: DetectedPr },
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
    #[serde(rename = "workflow.run.updated")]
    WorkflowRunUpdated { run: WorkflowRunSummary },
    #[serde(rename = "workflow.step.updated")]
    WorkflowStepUpdated {
        run_id: String,
        step: WorkflowStepUpdate,
    },
    #[serde(rename = "workflow.interaction.created")]
    WorkflowInteractionCreated {
        interaction: WorkflowInteractionSummary,
    },
    #[serde(rename = "workflow.interaction.resolved")]
    WorkflowInteractionResolved {
        interaction_id: String,
        run_id: String,
    },
    #[serde(rename = "workflow.completed")]
    WorkflowCompleted {
        workflow_id: String,
        workflow_name: String,
        run_id: String,
        outputs: serde_json::Value,
    },
}

// ─── ClientEvent (client→server) ─────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum ClientEvent {
    #[serde(rename = "message.send")]
    MessageSend {
        chat_id: String,
        content: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        attachment_ids: Option<Vec<String>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        metadata: Option<MessageSendMetadata>,
    },
    #[serde(rename = "permission.respond")]
    PermissionRespond {
        chat_id: String,
        response: ControlResponse,
    },
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
mod tests {
    use super::*;
    use serde_json::{Value, json};

    /// Extract the event object(s) from a golden fixture: strips `_provenance`
    /// and returns the `minimal`/`full` variants, or the flat event itself.
    fn events_from_fixture(raw: &str) -> Vec<Value> {
        let mut root: Value = serde_json::from_str(raw).unwrap();
        let obj = root.as_object_mut().unwrap();
        obj.remove("_provenance");
        if obj.contains_key("minimal") || obj.contains_key("full") {
            let mut out = Vec::new();
            if let Some(m) = obj.remove("minimal") {
                out.push(m);
            }
            if let Some(f) = obj.remove("full") {
                out.push(f);
            }
            out
        } else {
            vec![Value::Object(obj.clone())]
        }
    }

    /// Canonicalize every JSON number to f64 so that a fixture's integer-literal
    /// `0` for an f64 field (e.g. `totalCost`) compares equal to Rust's `0.0`.
    /// All fixture numbers are < 2^53, so f64 is lossless here.
    fn norm(v: &Value) -> Value {
        match v {
            Value::Number(n) => n.as_f64().map(|f| json!(f)).unwrap_or_else(|| v.clone()),
            Value::Array(a) => Value::Array(a.iter().map(norm).collect()),
            Value::Object(o) => {
                Value::Object(o.iter().map(|(k, val)| (k.clone(), norm(val))).collect())
            }
            _ => v.clone(),
        }
    }

    fn assert_daemon_roundtrip(raw: &str) {
        for ev in events_from_fixture(raw) {
            let parsed: DaemonEvent = serde_json::from_value(ev.clone())
                .map_err(|e| format!("deserialize failed: {e}\n{ev:#}"))
                .unwrap();
            let back = serde_json::to_value(&parsed).unwrap();
            assert_eq!(norm(&ev), norm(&back), "round-trip mismatch");
        }
    }

    // ── The six representative fixtures the task pins ───────────────────────
    #[test]
    fn fixture_permission_requested() {
        assert_daemon_roundtrip(include_str!(
            "../../../../../docs/rust-port/fixtures/event.permission-requested.json"
        ));
    }

    #[test]
    fn fixture_display_message_added() {
        assert_daemon_roundtrip(include_str!(
            "../../../../../docs/rust-port/fixtures/event.display-message-added.json"
        ));
    }

    #[test]
    fn fixture_chat_updated() {
        assert_daemon_roundtrip(include_str!(
            "../../../../../docs/rust-port/fixtures/event.chat-updated.json"
        ));
    }

    #[test]
    fn fixture_message_queued_snapshot() {
        assert_daemon_roundtrip(include_str!(
            "../../../../../docs/rust-port/fixtures/event.message-queued-snapshot.json"
        ));
    }

    #[test]
    fn fixture_workflow_run_updated() {
        assert_daemon_roundtrip(include_str!(
            "../../../../../docs/rust-port/fixtures/event.workflow-run-updated.json"
        ));
    }

    #[test]
    fn fixture_background_task_updated() {
        assert_daemon_roundtrip(include_str!(
            "../../../../../docs/rust-port/fixtures/event.background_task-updated.json"
        ));
    }

    // ── A broader sweep across variant families ─────────────────────────────
    #[test]
    fn fixture_connection_ready() {
        assert_daemon_roundtrip(include_str!(
            "../../../../../docs/rust-port/fixtures/event.connection-ready.json"
        ));
    }

    #[test]
    fn fixture_chat_created() {
        assert_daemon_roundtrip(include_str!(
            "../../../../../docs/rust-port/fixtures/event.chat-created.json"
        ));
    }

    #[test]
    fn fixture_message_added() {
        assert_daemon_roundtrip(include_str!(
            "../../../../../docs/rust-port/fixtures/event.message-added.json"
        ));
    }

    #[test]
    fn fixture_context_updated() {
        assert_daemon_roundtrip(include_str!(
            "../../../../../docs/rust-port/fixtures/event.context-updated.json"
        ));
    }

    #[test]
    fn fixture_process_started() {
        assert_daemon_roundtrip(include_str!(
            "../../../../../docs/rust-port/fixtures/event.process-started.json"
        ));
    }

    #[test]
    fn fixture_chat_context_usage() {
        assert_daemon_roundtrip(include_str!(
            "../../../../../docs/rust-port/fixtures/event.chat-contextUsage.json"
        ));
    }

    #[test]
    fn fixture_adapter_models_updated() {
        assert_daemon_roundtrip(include_str!(
            "../../../../../docs/rust-port/fixtures/event.adapter-models-updated.json"
        ));
    }

    #[test]
    fn fixture_tunnel_status() {
        assert_daemon_roundtrip(include_str!(
            "../../../../../docs/rust-port/fixtures/event.tunnel-status.json"
        ));
    }

    #[test]
    fn fixture_workflow_step_updated() {
        assert_daemon_roundtrip(include_str!(
            "../../../../../docs/rust-port/fixtures/event.workflow-step-updated.json"
        ));
    }

    #[test]
    fn fixture_message_queued() {
        // Exercises the `ref` field (Rust raw identifier `r#ref`).
        assert_daemon_roundtrip(include_str!(
            "../../../../../docs/rust-port/fixtures/event.message-queued.json"
        ));
    }

    #[test]
    fn fixture_error() {
        assert_daemon_roundtrip(include_str!(
            "../../../../../docs/rust-port/fixtures/event.error.json"
        ));
    }

    // ── ClientEvent shapes (no captured fixtures; from the TS union) ─────────
    fn assert_client_roundtrip(v: Value) {
        let parsed: ClientEvent = serde_json::from_value(v.clone()).unwrap();
        let back = serde_json::to_value(&parsed).unwrap();
        assert_eq!(v, back);
    }

    #[test]
    fn client_message_send_minimal_and_full() {
        assert_client_roundtrip(json!({
            "type": "message.send",
            "chatId": "chat_1",
            "content": "hello"
        }));
        assert_client_roundtrip(json!({
            "type": "message.send",
            "chatId": "chat_1",
            "content": "run it",
            "attachmentIds": ["att_1"],
            "metadata": { "command": { "name": "review", "source": "user", "args": "--fast" } }
        }));
    }

    #[test]
    fn client_subscribe_and_file() {
        assert_client_roundtrip(json!({ "type": "subscribe", "chatId": "chat_1" }));
        assert_client_roundtrip(json!({ "type": "unsubscribe", "chatId": "chat_1" }));
        assert_client_roundtrip(json!({ "type": "subscribe:file", "path": "/a/b.ts" }));
        assert_client_roundtrip(json!({
            "type": "unsubscribe:file",
            "path": "/a/b.ts",
            "projectId": "proj_1",
            "chatId": "chat_1"
        }));
    }
}

// PORT STATUS: packages/types/src/events.ts (114 lines)
// confidence: high
// todos: 0
// notes: DaemonEvent (54 variants) + ClientEvent (6) as internally-tagged enums;
// dotted/colon tag strings via per-variant rename, fields camelCased via
// rename_all_fields. Numbers per §6.3: chat.contextUsage.percentage=f64,
// tokens/port/count=i64. workflow.step.updated's `step` is a dedicated
// WorkflowStepUpdate struct (TS Pick has no direct Rust analog). message.queued
// uses raw identifier r#ref (serializes "ref"). Golden round-trip tests
// include_str! the fixtures relative to the workspace root; the six task-pinned
// fixtures plus a family sweep + ClientEvent shapes are covered. The golden
// comparator canonicalizes numbers to f64 so a fixture's integer-literal `0` for
// an f64 field (Chat.totalCost) matches Rust's `0.0` — see the Phase-B WIRE NOTE
// in chat.rs (serde_json `0.0` vs Node `0`). References sibling modules
// crate::{plugin,launch,background_task,workflow} owned by the companion
// types-port task (UIZone is spelled UiZone there).
