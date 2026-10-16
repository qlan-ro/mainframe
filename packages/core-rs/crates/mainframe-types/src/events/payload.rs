//! Small payload enums and structs carried by `DaemonEvent` variants
//! (event-local literal unions).

use serde::{Deserialize, Serialize};

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

/// Which producer raised a `chat.notification` — lets a client single out an
/// attention request without adding a parallel event type. Optional on the
/// wire: absent on old daemons and never required by the mobile client.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatNotificationKind {
    TaskComplete,
    SessionError,
    AttentionRequest,
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

/// `notification.created`'s optional `links` payload. Unlike
/// `AutomationNotificationLinks` there is no run to key off — a standalone
/// notification (e.g. from `lane_apply.py`) carries chat ids only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationLinks {
    pub chat_ids: Vec<String>,
}
