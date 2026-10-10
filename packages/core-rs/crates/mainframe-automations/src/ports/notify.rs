//! Notifier port (contract §4): the engine hands a rendered notification to
//! this port; the production impl emits the WS `automation.notification` event
//! and pushes to mobile. Always best-effort — a notification failure never
//! fails a step.

use serde::Serialize;

use crate::engine::BoxFuture;

pub use mainframe_types::automation::AutomationNotificationLinks as NotificationLinks;

/// The §4 `automation.notification` body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    pub run_id: String,
    pub automation_id: String,
    pub title: String,
    pub body: String,
    pub links: NotificationLinks,
}

#[derive(Debug, Clone, thiserror::Error)]
#[error("{0}")]
pub struct NotifyError(pub String);

pub trait Notifier: Send + Sync {
    fn notify(&self, notification: Notification) -> BoxFuture<'_, Result<(), NotifyError>>;
}
