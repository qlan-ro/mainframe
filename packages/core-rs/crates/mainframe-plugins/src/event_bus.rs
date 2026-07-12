//! Ported from `packages/core/src/plugins/event-bus.ts`.
//!
//! Two channels per plugin: an in-process emitter for the plugin's own
//! `emit`/`on`/`onChatEvent` topics, and a subscription to the sanitized public
//! daemon bus (`onDaemonEvent`). Public events are namespaced under
//! `plugin:public:<name>` so a plugin can never subscribe to raw daemon events
//! (CONCURRENCY.tsv event-bus row: broadcast::Sender per bus, sanitized
//! re-publish for public events).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use mainframe_types::plugin::{ChatEvent, PublicDaemonEvent};
use serde_json::Value;
use tokio::sync::broadcast;

use crate::PluginError;
use crate::context::PluginEventBus;

pub const PUBLIC_DAEMON_EVENT_PREFIX: &str = "plugin:public:";

/// The sanitized public daemon bus shared across all plugin buses. Wraps a
/// broadcast so each `onDaemonEvent` subscription gets its own receiver.
#[derive(Clone)]
pub struct PublicDaemonBus {
    tx: broadcast::Sender<PublicDaemonEvent>,
}

impl Default for PublicDaemonBus {
    fn default() -> Self {
        Self::new()
    }
}

impl PublicDaemonBus {
    pub fn new() -> Self {
        let (tx, _rx) = broadcast::channel(256);
        Self { tx }
    }

    /// `emitPublicDaemonEvent` — publish a sanitized public event to all buses.
    /// Called by ChatManager / ProjectManager; never carries raw message content.
    pub fn emit_public(&self, event: PublicDaemonEvent) {
        // A send with no live receivers is not an error here (best-effort fan-out).
        let _ = self.tx.send(event);
    }

    fn subscribe(&self) -> broadcast::Receiver<PublicDaemonEvent> {
        self.tx.subscribe()
    }
}

type InternalHandler = Arc<dyn Fn(Value) + Send + Sync>;

/// Per-plugin event bus. `internal` is an EventEmitter analogue (synchronous
/// `emit` dispatch); `daemon` is the shared public bus.
pub struct PluginEventBusImpl {
    plugin_id: String,
    internal: Mutex<HashMap<String, Vec<InternalHandler>>>,
    daemon: Arc<PublicDaemonBus>,
}

/// `createPluginEventBus(pluginId, daemonBus)`.
pub fn create_plugin_event_bus(
    plugin_id: &str,
    daemon: Arc<PublicDaemonBus>,
) -> PluginEventBusImpl {
    PluginEventBusImpl {
        plugin_id: plugin_id.to_string(),
        internal: Mutex::new(HashMap::new()),
        daemon,
    }
}

impl PluginEventBusImpl {
    fn dispatch(&self, topic: &str, payload: &Value) {
        let handlers = self
            .internal
            .lock()
            .map(|map| map.get(topic).cloned().unwrap_or_default())
            .unwrap_or_default();
        for handler in handlers {
            handler(payload.clone());
        }
    }

    fn register(&self, topic: String, handler: InternalHandler) {
        if let Ok(mut map) = self.internal.lock() {
            map.entry(topic).or_default().push(handler);
        }
    }
}

impl PluginEventBus for PluginEventBusImpl {
    fn emit(&self, event: &str, payload: Value) -> Result<(), PluginError> {
        let topic = format!("{}:{}", self.plugin_id, event);
        self.dispatch(&topic, &payload);
        Ok(())
    }

    fn on(&self, event: &str, handler: InternalHandler) -> Result<(), PluginError> {
        self.register(format!("{}:{}", self.plugin_id, event), handler);
        Ok(())
    }

    fn on_daemon_event(
        &self,
        _event: &str,
        handler: Arc<dyn Fn(PublicDaemonEvent) + Send + Sync>,
    ) -> Result<(), PluginError> {
        // Subscribes to the namespaced public channel only — never raw daemon
        // events. The bus already carries only sanitized public events (the
        // `plugin:public:` prefix is realized by the bus itself), matching the TS
        // single-channel subscribe. A forwarding task delivers to the handler.
        let mut rx = self.daemon.subscribe();
        tokio::spawn(async move {
            while let Ok(event) = rx.recv().await {
                handler(event);
            }
        });
        Ok(())
    }

    fn on_chat_event(
        &self,
        event: &str,
        handler: Arc<dyn Fn(ChatEvent) + Send + Sync>,
    ) -> Result<(), PluginError> {
        // Chat events arrive on the internal emitter under `<id>:chat:<event>`;
        // wrap the typed handler to decode the Value payload.
        let topic = format!("{}:chat:{}", self.plugin_id, event);
        let wrapped: InternalHandler = Arc::new(move |payload: Value| {
            if let Ok(chat_event) = serde_json::from_value::<ChatEvent>(payload) {
                handler(chat_event);
            }
        });
        self.register(topic, wrapped);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emit_invokes_registered_handlers() {
        let bus = create_plugin_event_bus("todos", Arc::new(PublicDaemonBus::new()));
        let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
        let clone = Arc::clone(&seen);
        bus.on("ping", Arc::new(move |p| clone.lock().unwrap().push(p)))
            .unwrap();
        bus.emit("ping", Value::from(42)).unwrap();
        assert_eq!(seen.lock().unwrap().as_slice(), [Value::from(42)]);
    }

    #[test]
    fn prefix_matches_ts_constant() {
        assert_eq!(PUBLIC_DAEMON_EVENT_PREFIX, "plugin:public:");
    }
}

// PORT STATUS: src/plugins/event-bus.ts
// confidence: medium
// todos: 1
// notes: internal EventEmitter → Mutex<HashMap<topic, Vec<handler>>> with
// synchronous emit dispatch (Node EventEmitter semantics). onDaemonEvent
// subscribes to a shared PublicDaemonBus (broadcast) and forwards on a spawned
// task. No builtin uses the bus yet (todos never touches ctx.events), so this is
// wired but exercised only by the emit/on unit test. TODO(port): the
// `plugin:public:<name>` topic filtering collapses into the bus carrying only
// sanitized public events; revisit if per-event subscription granularity is
// needed when ChatManager starts publishing.
