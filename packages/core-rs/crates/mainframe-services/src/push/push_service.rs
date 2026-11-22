//! Mobile push delivery through the Expo push API.
//!
//! Pushes go to every registered device token while the desktop is idle. A
//! desktop activity report suppresses them for six minutes, after which a
//! timer resumes delivery unless the desktop reports again.

use mainframe_types::sync::LockExt as _;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::runtime::Handle;
use tokio::task::JoinHandle;

const EXPO_PUSH_URL: &str = "https://exp.host/--/api/v2/push/send";
/// How long a desktop activity report suppresses pushes.
const STALENESS: Duration = Duration::from_secs(6 * 60);
/// Deadline for one Expo request. Automation notify steps await the send, so
/// a stalled connection must not hold a run open.
const SEND_TIMEOUT: Duration = Duration::from_secs(15);
/// The ticket error Expo returns for a token whose app was uninstalled.
const DEVICE_NOT_REGISTERED: &str = "DeviceNotRegistered";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PushPriority {
    Default,
    High,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushMessage {
    pub title: String,
    pub body: String,
    pub data: serde_json::Value,
    pub priority: PushPriority,
}

/// The outbound per-token Expo message. `sound` is `'default'` for high-priority
/// pushes, omitted otherwise.
#[derive(Debug, Clone, PartialEq, Serialize)]
struct ExpoPushMessage {
    to: String,
    title: String,
    body: String,
    data: serde_json::Value,
    priority: PushPriority,
    #[serde(skip_serializing_if = "Option::is_none")]
    sound: Option<&'static str>,
}

/// Expo answers a batch with one ticket per message, in message order.
#[derive(Debug, Default, Deserialize)]
struct ExpoResponse {
    #[serde(default)]
    data: Vec<ExpoTicket>,
}

#[derive(Debug, Deserialize)]
struct ExpoTicket {
    status: String,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    details: Option<ExpoTicketDetails>,
}

#[derive(Debug, Deserialize)]
struct ExpoTicketDetails {
    #[serde(default)]
    error: Option<String>,
}

struct Inner {
    /// Push token per paired device id.
    devices: HashMap<String, String>,
    desktop_active: bool,
    staleness_handle: Option<JoinHandle<()>>,
}

/// Shared between the routes that register devices and report desktop
/// activity, the notification paths that send, and the staleness timer. No
/// lock is held across an `.await`.
pub struct PushService {
    inner: Arc<Mutex<Inner>>,
    rt: Option<Handle>,
    client: Result<reqwest::Client, reqwest::Error>,
    url: String,
}

impl Default for PushService {
    fn default() -> Self {
        Self::new()
    }
}

impl PushService {
    #[must_use]
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                devices: HashMap::new(),
                desktop_active: false,
                staleness_handle: None,
            })),
            rt: Handle::try_current().ok(),
            client: mainframe_runtime::http::client(),
            url: EXPO_PUSH_URL.to_string(),
        }
    }

    #[cfg(test)]
    fn with_url(url: String) -> Self {
        Self { url, ..Self::new() }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock_recover()
    }

    pub fn register_device(&self, device_id: &str, push_token: &str) {
        self.lock()
            .devices
            .insert(device_id.to_string(), push_token.to_string());
        tracing::info!(device_id, "push token registered");
    }

    pub fn unregister_device(&self, device_id: &str) {
        self.lock().devices.remove(device_id);
    }

    #[must_use]
    pub fn has_registered_devices(&self) -> bool {
        !self.lock().devices.is_empty()
    }

    /// Record desktop activity. An active report suppresses pushes and
    /// restarts the staleness timer; the timer is replaced under the same lock
    /// so concurrent reports cannot leave an orphaned timer behind.
    pub fn set_desktop_active(&self, active: bool) {
        {
            let mut inner = self.lock();
            inner.desktop_active = active;
            if let Some(handle) = inner.staleness_handle.take() {
                handle.abort();
            }
            if active && let Some(rt) = &self.rt {
                let shared = Arc::clone(&self.inner);
                inner.staleness_handle = Some(rt.spawn(async move {
                    tokio::time::sleep(STALENESS).await;
                    shared.lock_recover().desktop_active = false;
                    tracing::info!("desktop staleness timeout — resuming push");
                }));
            }
        }
        tracing::info!(active, "desktop active state changed");
    }

    /// Send `message` to every registered device unless the desktop is active.
    /// Failures are logged; a token Expo reports as no longer registered is
    /// dropped until its device registers again.
    pub async fn send_push(&self, message: PushMessage) {
        let messages = self.collect_push_messages(&message);
        if messages.is_empty() {
            return;
        }
        let client = match &self.client {
            Ok(client) => client,
            Err(err) => {
                tracing::error!(error = %err, "push HTTP client unavailable");
                return;
            }
        };
        let response = match client
            .post(&self.url)
            .timeout(SEND_TIMEOUT)
            .json(&messages)
            .send()
            .await
        {
            Ok(response) => response,
            Err(err) => {
                tracing::error!(error = %err, "failed to send push notification");
                return;
            }
        };
        let status = response.status();
        if !status.is_success() {
            tracing::error!(status = status.as_u16(), "expo push API error");
            return;
        }
        match response.json::<ExpoResponse>().await {
            Ok(body) => self.apply_tickets(&messages, &body.data),
            Err(err) => tracing::warn!(error = %err, "unreadable expo push response"),
        }
    }

    fn apply_tickets(&self, messages: &[ExpoPushMessage], tickets: &[ExpoTicket]) {
        let mut unregistered: HashSet<&str> = HashSet::new();
        for (message, ticket) in messages.iter().zip(tickets) {
            if ticket.status == "ok" {
                continue;
            }
            let error = ticket.details.as_ref().and_then(|d| d.error.as_deref());
            tracing::warn!(
                error,
                message = ticket.message.as_deref(),
                "expo rejected a push"
            );
            if error == Some(DEVICE_NOT_REGISTERED) {
                unregistered.insert(message.to.as_str());
            }
        }
        if unregistered.is_empty() {
            return;
        }
        self.lock().devices.retain(|device_id, token| {
            let keep = !unregistered.contains(token.as_str());
            if !keep {
                tracing::info!(device_id, "dropping a push token expo no longer accepts");
            }
            keep
        });
    }

    /// One Expo message per distinct token, or none while the desktop is
    /// active. Kept apart from the network call so it is testable offline.
    fn collect_push_messages(&self, message: &PushMessage) -> Vec<ExpoPushMessage> {
        let tokens: Vec<String> = {
            let inner = self.lock();
            if inner.desktop_active {
                tracing::debug!("push suppressed — desktop is active");
                return Vec::new();
            }
            let mut seen = HashSet::new();
            inner
                .devices
                .values()
                .filter(|token| seen.insert(token.as_str()))
                .cloned()
                .collect()
        };
        let sound = (message.priority == PushPriority::High).then_some("default");
        tokens
            .into_iter()
            .map(|to| ExpoPushMessage {
                to,
                title: message.title.clone(),
                body: message.body.clone(),
                data: message.data.clone(),
                priority: message.priority,
                sound,
            })
            .collect()
    }
}

#[cfg(test)]
#[path = "push_service_tests.rs"]
mod tests;
