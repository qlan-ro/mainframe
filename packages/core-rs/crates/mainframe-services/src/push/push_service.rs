//! Ported from `src/push/push-service.ts`.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::runtime::Handle;
use tokio::task::JoinHandle;

const EXPO_PUSH_URL: &str = "https://exp.host/--/api/v2/push/send";
/// 6 minutes.
const STALENESS_MS: u64 = 6 * 60 * 1000;

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
/// pushes, omitted otherwise (mirrors `sound: undefined`).
#[derive(Debug, Clone, PartialEq, Serialize)]
struct ExpoPushMessage {
    to: String,
    title: String,
    body: String,
    data: serde_json::Value,
    priority: PushPriority,
    #[serde(skip_serializing_if = "Option::is_none")]
    sound: Option<String>,
}

#[derive(Debug, Clone)]
struct RegisteredDevice {
    push_token: String,
    connected: bool,
}

struct Inner {
    devices: HashMap<String, RegisteredDevice>,
    desktop_active: bool,
    staleness_handle: Option<JoinHandle<()>>,
}

/// `PushService`. The single-threaded JS class becomes shared interior state:
/// `Arc<Mutex<Inner>>` is touched by the public methods and by the spawned
/// staleness timer (§3.3: `setTimeout` → named task + JoinHandle; shared state →
/// `Arc<Mutex>`). No lock is ever held across an `.await`.
pub struct PushService {
    inner: Arc<Mutex<Inner>>,
    rt: Option<Handle>,
    client: reqwest::Client,
    url: String,
}

impl Default for PushService {
    fn default() -> Self {
        Self::new()
    }
}

impl PushService {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                devices: HashMap::new(),
                desktop_active: false,
                staleness_handle: None,
            })),
            rt: Handle::try_current().ok(),
            client: reqwest::Client::new(),
            url: EXPO_PUSH_URL.to_string(),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn register_device(&self, device_id: &str, push_token: &str) {
        {
            let mut inner = self.lock();
            let connected = inner
                .devices
                .get(device_id)
                .map(|d| d.connected)
                .unwrap_or(false);
            inner.devices.insert(
                device_id.to_string(),
                RegisteredDevice {
                    push_token: push_token.to_string(),
                    connected,
                },
            );
        }
        tracing::info!(module = "push", device_id, "push token registered");
    }

    pub fn unregister_device(&self, device_id: &str) {
        self.lock().devices.remove(device_id);
    }

    pub fn set_device_connected(&self, device_id: &str, connected: bool) {
        let mut inner = self.lock();
        if let Some(device) = inner.devices.get_mut(device_id) {
            device.connected = connected;
        }
    }

    pub fn is_device_connected(&self, device_id: &str) -> bool {
        self.lock()
            .devices
            .get(device_id)
            .map(|d| d.connected)
            .unwrap_or(false)
    }

    pub fn has_registered_devices(&self) -> bool {
        !self.lock().devices.is_empty()
    }

    pub fn set_desktop_active(&self, active: bool) {
        {
            let mut inner = self.lock();
            inner.desktop_active = active;
            if let Some(handle) = inner.staleness_handle.take() {
                handle.abort();
            }
        }
        if active && let Some(rt) = &self.rt {
            let inner = Arc::clone(&self.inner);
            let handle = rt.spawn(async move {
                tokio::time::sleep(Duration::from_millis(STALENESS_MS)).await;
                let mut guard = inner.lock().unwrap_or_else(PoisonError::into_inner);
                guard.desktop_active = false;
                tracing::info!(module = "push", "desktop staleness timeout — resuming push");
            });
            self.lock().staleness_handle = Some(handle);
        }
        tracing::info!(module = "push", active, "desktop active state changed");
    }

    pub fn dispose(&self) {
        if let Some(handle) = self.lock().staleness_handle.take() {
            handle.abort();
        }
    }

    pub async fn send_push(&self, message: PushMessage) {
        let messages = self.collect_push_messages(&message);
        if messages.is_empty() {
            return;
        }

        match self.client.post(&self.url).json(&messages).send().await {
            Ok(res) => {
                if !res.status().is_success() {
                    tracing::error!(
                        module = "push",
                        status = res.status().as_u16(),
                        "expo push API error"
                    );
                }
            }
            Err(err) => {
                tracing::error!(module = "push", ?err, "failed to send push notification");
            }
        }
    }

    /// The message-building half of `sendPush`, factored out so it is testable
    /// without a live network round-trip (the TS test mocked `fetch`; this port
    /// asserts the built messages directly). Returns empty when suppressed or
    /// when there are no disconnected devices.
    fn collect_push_messages(&self, message: &PushMessage) -> Vec<ExpoPushMessage> {
        let tokens = {
            let inner = self.lock();
            if inner.desktop_active {
                tracing::debug!(module = "push", "push suppressed — desktop is active");
                return Vec::new();
            }
            let mut seen: HashSet<String> = HashSet::new();
            let mut tokens: Vec<String> = Vec::new();
            for device in inner.devices.values() {
                if !device.connected && seen.insert(device.push_token.clone()) {
                    tokens.push(device.push_token.clone());
                }
            }
            tokens
        };

        if tokens.is_empty() {
            return Vec::new();
        }

        tokens
            .into_iter()
            .map(|token| ExpoPushMessage {
                to: token,
                title: message.title.clone(),
                body: message.body.clone(),
                data: message.data.clone(),
                priority: message.priority,
                sound: if message.priority == PushPriority::High {
                    Some("default".to_string())
                } else {
                    None
                },
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn msg(priority: PushPriority) -> PushMessage {
        PushMessage {
            title: "Test".to_string(),
            body: "Test".to_string(),
            data: json!({}),
            priority,
        }
    }

    #[tokio::test]
    async fn registers_a_push_token() {
        let service = PushService::new();
        service.register_device("device-1", "ExponentPushToken[xxx]");
        assert!(service.has_registered_devices());
    }

    #[tokio::test]
    async fn tracks_connected_devices() {
        let service = PushService::new();
        service.register_device("device-1", "ExponentPushToken[xxx]");
        service.set_device_connected("device-1", true);
        assert!(service.is_device_connected("device-1"));

        service.set_device_connected("device-1", false);
        assert!(!service.is_device_connected("device-1"));
    }

    #[tokio::test]
    async fn sends_to_disconnected_devices_only() {
        let service = PushService::new();
        service.register_device("device-1", "ExponentPushToken[aaa]");
        service.register_device("device-2", "ExponentPushToken[bbb]");
        service.set_device_connected("device-1", true);
        service.set_device_connected("device-2", false);

        let messages = service.collect_push_messages(&PushMessage {
            title: "Permission Required".to_string(),
            body: "Claude wants to run: npm test".to_string(),
            data: json!({ "chatId": "chat-1", "type": "permission" }),
            priority: PushPriority::High,
        });
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].to, "ExponentPushToken[bbb]");
    }

    #[tokio::test]
    async fn skips_push_when_all_devices_connected() {
        let service = PushService::new();
        service.register_device("device-1", "ExponentPushToken[aaa]");
        service.set_device_connected("device-1", true);
        assert!(
            service
                .collect_push_messages(&msg(PushPriority::Default))
                .is_empty()
        );
    }

    #[tokio::test]
    async fn unregisters_a_device() {
        let service = PushService::new();
        service.register_device("device-1", "ExponentPushToken[xxx]");
        assert!(service.has_registered_devices());
        service.unregister_device("device-1");
        assert!(!service.has_registered_devices());
    }

    #[tokio::test]
    async fn skips_push_when_desktop_active() {
        let service = PushService::new();
        service.register_device("device-1", "ExponentPushToken[aaa]");
        service.set_desktop_active(true);
        assert!(
            service
                .collect_push_messages(&msg(PushPriority::Default))
                .is_empty()
        );
        service.dispose();
    }

    #[tokio::test]
    async fn sends_push_when_desktop_idle() {
        let service = PushService::new();
        service.register_device("device-1", "ExponentPushToken[aaa]");
        service.set_desktop_active(true);
        service.set_desktop_active(false);
        assert_eq!(
            service
                .collect_push_messages(&msg(PushPriority::Default))
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn deduplicates_shared_push_tokens() {
        let service = PushService::new();
        service.register_device("device-1", "ExponentPushToken[aaa]");
        service.register_device("device-2", "ExponentPushToken[aaa]");

        let messages = service.collect_push_messages(&msg(PushPriority::Default));
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].to, "ExponentPushToken[aaa]");
    }

    #[tokio::test(start_paused = true)]
    async fn expires_desktop_active_after_staleness_timeout() {
        let service = PushService::new();
        service.register_device("device-1", "ExponentPushToken[aaa]");
        service.set_desktop_active(true);

        // Let the spawned timer task get polled so it registers its sleep at t0,
        // then advance past the 6-minute staleness timeout and let it run.
        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_millis(STALENESS_MS + 100)).await;
        for _ in 0..10 {
            if !service
                .collect_push_messages(&msg(PushPriority::Default))
                .is_empty()
            {
                break;
            }
            tokio::task::yield_now().await;
        }

        assert_eq!(
            service
                .collect_push_messages(&msg(PushPriority::Default))
                .len(),
            1
        );
    }

    #[tokio::test(start_paused = true)]
    async fn resets_staleness_timer_on_repeated_set_desktop_active_true() {
        let service = PushService::new();
        service.register_device("device-1", "ExponentPushToken[aaa]");
        service.set_desktop_active(true);
        tokio::task::yield_now().await; // let timer1 register its sleep at t0

        // Advance 5 minutes, then re-report active (resets the timer).
        tokio::time::advance(Duration::from_millis(5 * 60 * 1000)).await;
        service.set_desktop_active(true);
        tokio::task::yield_now().await; // let timer2 register its sleep at t0+5m

        // Advance another 5 minutes (10 total, but only 5 since last active).
        tokio::time::advance(Duration::from_millis(5 * 60 * 1000)).await;
        tokio::task::yield_now().await;

        // Still suppressed — timer was reset.
        assert!(
            service
                .collect_push_messages(&msg(PushPriority::Default))
                .is_empty()
        );
        service.dispose();
    }
}

// PORT STATUS: src/push/push-service.ts (112 lines)
// confidence: high
// todos: 0
// notes: JS class → Arc<Mutex<Inner>> (devices + desktop_active + timer handle)
// shared with the spawned staleness timer (§3.3). setTimeout → tokio::spawn +
// JoinHandle captured for abort (clearTimeout). setDesktopActive spawns via a
// stored runtime Handle (captured in new()); with no runtime the timer is skipped
// (graceful). std Mutex poison is recovered (into_inner) — never .unwrap(). The
// `messages` construction is extracted into collect_push_messages so tests assert
// the built payload without a network mock (the TS test stubbed global.fetch);
// send_push keeps the reqwest POST + the same status/err error logs. HashMap
// iteration order differs from the JS Map insertion order — only observable with
// multiple distinct disconnected tokens, an outbound (non-frozen) ordering.
