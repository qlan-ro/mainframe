//! An editor session over a running language server. A server outlives its
//! sessions: the first session's `initialize` result is cached, and a later
//! session's handshake is answered from that cache, because a server accepts
//! `initialize` only once.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::Value;
use tokio::sync::mpsc;

use crate::manager::{ClientSlot, LspServerHandle, ManagerState};

/// What the socket should send next.
#[derive(Debug, PartialEq, Eq)]
pub enum ClientEvent {
    /// A JSON-RPC message for the editor.
    Message(String),
    /// Close the socket: the server exited, shut down, or another session
    /// replaced this one.
    Close { code: u16, reason: &'static str },
}

static NEXT_CLIENT_ID: AtomicU64 = AtomicU64::new(1);

pub struct LspClient {
    state: Arc<ManagerState>,
    handle: Arc<LspServerHandle>,
    id: u64,
    events: mpsc::UnboundedReceiver<ClientEvent>,
    /// The session attached to an initialized server and is still replaying
    /// its handshake from the cache.
    replaying: bool,
}

impl LspClient {
    pub(crate) fn attach(state: Arc<ManagerState>, handle: Arc<LspServerHandle>) -> Self {
        let id = NEXT_CLIENT_ID.fetch_add(1, Ordering::Relaxed);
        let (events_tx, events) = mpsc::unbounded_channel();
        let replaying = handle.initialize_result().is_some();
        let slot = ClientSlot::new(id, events_tx, replaying);
        let previous = state.attach_client(&handle, slot);
        if let Some(previous) = previous {
            tracing::info!(language = %handle.language(), "closing the LSP session this connection replaces");
            previous.close(1001, "Replaced by new client");
        }
        Self {
            state,
            handle,
            id,
            events,
            replaying,
        }
    }

    pub fn is_reattach(&self) -> bool {
        self.replaying
    }

    /// The next event for the socket; `None` once the session is detached.
    pub async fn recv(&mut self) -> Option<ClientEvent> {
        self.events.recv().await
    }

    /// Forwards one editor message to the server, waiting for stdin room.
    /// While a reconnecting session replays its handshake, `initialize` is
    /// answered from the cache and `initialized` is dropped.
    pub async fn forward(&mut self, message: String) {
        if self.replaying {
            match classify_replay(&message) {
                Replay::Initialize { id } => {
                    if let Some(result) = self.handle.initialize_result() {
                        let reply =
                            serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": result });
                        self.handle.send_to_client(self.id, reply.to_string());
                    }
                    return;
                }
                Replay::Initialized => {
                    self.go_live();
                    return;
                }
                Replay::Other => self.go_live(),
            }
        }
        if let Err(error) = self.handle.write(&message).await {
            tracing::warn!(%error, language = %self.handle.language(), "LSP message not written to the server");
        }
    }

    fn go_live(&mut self) {
        self.replaying = false;
        self.handle.go_live(self.id);
    }
}

impl Drop for LspClient {
    fn drop(&mut self) {
        self.state.detach_client(&self.handle, self.id);
    }
}

enum Replay {
    Initialize { id: Value },
    Initialized,
    Other,
}

fn classify_replay(message: &str) -> Replay {
    let Ok(value) = serde_json::from_str::<Value>(message) else {
        return Replay::Other;
    };
    match value.get("method").and_then(Value::as_str) {
        Some("initialize") => match value.get("id") {
            Some(id) if !id.is_null() => Replay::Initialize { id: id.clone() },
            _ => Replay::Other,
        },
        Some("initialized") => Replay::Initialized,
        _ => Replay::Other,
    }
}

#[cfg(test)]
#[path = "client_tests.rs"]
mod tests;
