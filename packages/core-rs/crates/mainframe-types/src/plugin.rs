//! Ported from `packages/types/src/plugin.ts`.
//!
//! This module ports the **data** shapes only: capabilities, UI contribution
//! manifests, the public/chat event unions, and the service-summary DTOs. The
//! behavioral interfaces (`PluginContext`, `PluginEventBus`, `PluginUIContext`,
//! `PluginConfig`, `PluginDatabaseContext`, `PluginAttachmentContext`,
//! `ChatServiceAPI`, `ProjectServiceAPI`, `AdapterRegistrationAPI`, `PluginModule`)
//! are runtime contracts (they carry `pino.Logger`, an express `Router`, and
//! method signatures). They belong to the `mainframe-plugins` crate as traits, not
//! here as serde data.
// TODO(port): the plugin behavioral traits live in mainframe-plugins; per PORTING.md
// §2.9 v1 is builtin-only and external JS plugin loading is dropped.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PluginCapability {
    #[serde(rename = "storage")]
    Storage,
    #[serde(rename = "ui:panels")]
    UiPanels,
    #[serde(rename = "ui:notifications")]
    UiNotifications,
    #[serde(rename = "daemon:public-events")]
    DaemonPublicEvents,
    #[serde(rename = "chat:read")]
    ChatRead,
    #[serde(rename = "chat:read:content")]
    ChatReadContent,
    #[serde(rename = "chat:create")]
    ChatCreate,
    #[serde(rename = "adapters")]
    Adapters,
    #[serde(rename = "process:exec")]
    ProcessExec,
    #[serde(rename = "http:outbound")]
    HttpOutbound,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ZoneId {
    LeftTop,
    LeftBottom,
    RightTop,
    RightBottom,
    BottomLeft,
    BottomRight,
}

/// `UIZone = ZoneId | 'fullview'` — flattened into one enum (all values are
/// distinct kebab-case strings).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UiZone {
    LeftTop,
    LeftBottom,
    RightTop,
    RightBottom,
    BottomLeft,
    BottomRight,
    Fullview,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolWindowManifest {
    pub id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    pub default_zone: ZoneId,
    /// Owning plugin id (empty for built-in tool windows).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugin_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginUiContribution {
    pub plugin_id: String,
    pub panel_id: String,
    pub zone: UiZone,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginAction {
    pub id: String,
    pub plugin_id: String,
    pub label: String,
    pub shortcut: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginUiZoneContribution {
    pub zone: UiZone,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_windows: Option<Vec<ToolWindowManifest>>,
}

/// `ui?: PluginUIZoneContribution | PluginUIZoneContribution[]` — both forms are
/// accepted; untagged because the union has no discriminant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PluginManifestUi {
    Single(Box<PluginUiZoneContribution>),
    Multi(Vec<PluginUiZoneContribution>),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginAdapterManifest {
    pub binary_name: String,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginCommandManifest {
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    pub capabilities: Vec<PluginCapability>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui: Option<PluginManifestUi>,
    /// Adapter plugins only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adapter: Option<PluginAdapterManifest>,
    /// Custom commands this adapter exposes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commands: Option<Vec<PluginCommandManifest>>,
}

// ─── Public daemon events (never contain message content) ────────────────────
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PublicDaemonEvent {
    #[serde(rename = "chat.started", rename_all = "camelCase")]
    ChatStarted {
        chat_id: String,
        project_id: String,
        adapter_id: String,
    },
    #[serde(rename = "chat.completed", rename_all = "camelCase")]
    ChatCompleted {
        chat_id: String,
        project_id: String,
        cost: f64,
        duration_ms: i64,
    },
    #[serde(rename = "chat.error", rename_all = "camelCase")]
    ChatError {
        chat_id: String,
        project_id: String,
        error_message: String,
    },
    #[serde(rename = "project.added", rename_all = "camelCase")]
    ProjectAdded { project_id: String, path: String },
    #[serde(rename = "project.removed", rename_all = "camelCase")]
    ProjectRemoved { project_id: String },
}

// ─── Chat events (require 'chat:read' capability) ────────────────────────────
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ChatEvent {
    #[serde(rename = "message.added", rename_all = "camelCase")]
    MessageAdded {
        chat_id: String,
        message: crate::chat::ChatMessage,
    },
    #[serde(rename = "message.streaming", rename_all = "camelCase")]
    MessageStreaming {
        chat_id: String,
        message_id: String,
        delta: String,
    },
    #[serde(rename = "tool.called", rename_all = "camelCase")]
    ToolCalled {
        chat_id: String,
        tool_name: String,
        args: Value,
    },
    #[serde(rename = "tool.result", rename_all = "camelCase")]
    ToolResult {
        chat_id: String,
        tool_use_id: String,
        content: Value,
    },
}

// ─── Service APIs exposed to plugins (data DTOs) ─────────────────────────────
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSummary {
    pub id: String,
    pub title: Option<String>,
    pub project_id: String,
    pub adapter_id: String,
    pub created_at: String,
    pub total_cost: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginAttachmentMeta {
    pub id: String,
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub created_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capability_renames() {
        assert_eq!(
            serde_json::to_string(&PluginCapability::DaemonPublicEvents).unwrap(),
            "\"daemon:public-events\""
        );
        assert_eq!(
            serde_json::to_string(&PluginCapability::ChatReadContent).unwrap(),
            "\"chat:read:content\""
        );
    }

    #[test]
    fn zone_id_kebab() {
        assert_eq!(
            serde_json::to_string(&ZoneId::BottomLeft).unwrap(),
            "\"bottom-left\""
        );
    }

    #[test]
    fn manifest_ui_accepts_single_and_array() {
        let single = r#"{"zone":"left-top","label":"Files"}"#;
        let ui: PluginManifestUi = serde_json::from_str(single).unwrap();
        assert!(matches!(ui, PluginManifestUi::Single(_)));

        let multi = r#"[{"zone":"left-top","label":"Files"},{"zone":"fullview","label":"Board"}]"#;
        let ui: PluginManifestUi = serde_json::from_str(multi).unwrap();
        assert!(matches!(ui, PluginManifestUi::Multi(_)));
    }

    #[test]
    fn public_daemon_event_completed_tagged() {
        let json = r#"{"type":"chat.completed","chatId":"c1","projectId":"p1","cost":0.0842,"durationMs":1200}"#;
        let e: PublicDaemonEvent = serde_json::from_str(json).unwrap();
        assert!(matches!(e, PublicDaemonEvent::ChatCompleted { .. }));
        assert_eq!(serde_json::to_string(&e).unwrap(), json);
    }

    #[test]
    fn chat_event_message_added_carries_chat_message() {
        let json = r#"{"type":"message.added","chatId":"c1","message":{"id":"m1","chatId":"c1","type":"user","content":[],"timestamp":"2026-07-08T00:00:00.000Z"}}"#;
        let e: ChatEvent = serde_json::from_str(json).unwrap();
        assert!(matches!(e, ChatEvent::MessageAdded { .. }));
        assert_eq!(serde_json::to_string(&e).unwrap(), json);
    }

    #[test]
    fn chat_event_tool_called_tagged() {
        let json =
            r#"{"type":"tool.called","chatId":"c1","toolName":"Bash","args":{"command":"ls"}}"#;
        let e: ChatEvent = serde_json::from_str(json).unwrap();
        assert!(matches!(e, ChatEvent::ToolCalled { .. }));
        assert_eq!(serde_json::to_string(&e).unwrap(), json);
    }

    #[test]
    fn chat_summary_serializes_null_title() {
        let json = r#"{"id":"c1","title":null,"projectId":"p1","adapterId":"claude","createdAt":"2026-07-08T00:00:00Z","totalCost":0.0}"#;
        let s: ChatSummary = serde_json::from_str(json).unwrap();
        assert!(s.title.is_none());
        assert_eq!(serde_json::to_string(&s).unwrap(), json);
    }
}

// PORT STATUS: packages/types/src/plugin.ts (225 lines)
// confidence: medium
// todos: 1
// notes: only the serde-data shapes are ported (capabilities, UI manifests, the
// PublicDaemonEvent/ChatEvent tagged unions, ChatSummary/ProjectSummary/
// PluginAttachmentMeta). Behavioral interfaces carrying pino.Logger / express
// Router / method signatures are NOT ported here — they belong to
// mainframe-plugins as traits (v1 builtin-only; external JS plugin loading dropped
// per §2.9). PublicDaemonEventName / ChatEventName string-union aliases collapse
// into the tagged-enum discriminants. cost/totalCost are f64 (fractional);
// durationMs/sizeBytes are i64. ChatEvent.message is crate::chat::ChatMessage.
// ChatSummary.title (string|null) is required-nullable → Option WITHOUT skip.
// PublicDaemonEvent/ChatEvent/ChatSummary derive PartialEq (Value/f64 are not Eq).
