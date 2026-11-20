use std::sync::{Arc, Mutex, MutexGuard};

use mainframe_runtime::process::{ManagedProcess, StdinWriteError, StdinWriter};
use mainframe_types::sync::LockExt as _;
use serde_json::Value;
use tokio::sync::{Notify, mpsc};
use tokio::task::JoinHandle;

use crate::client::ClientEvent;
use crate::framing;

/// The id of the daemon's own `shutdown` request, matched against the
/// server's responses to detect the acknowledgement.
pub(super) const SHUTDOWN_REQUEST_ID: &str = "mainframe-shutdown";

/// One running language server. Its stdout pump lives as long as the child,
/// so editor sessions can come and go without losing the pipe.
pub struct LspServerHandle {
    pub(super) key: String,
    pub(super) project_id: String,
    pub(super) language: String,
    pub(super) project_path: String,
    pub(super) pid: u32,
    pub(super) process: ManagedProcess,
    pub(super) stdin: StdinWriter,
    pub(super) shared: Arc<Shared>,
}

/// What the handle shares with its stdout pump.
#[derive(Default)]
pub(super) struct Shared {
    inner: Mutex<Inner>,
    shutdown_ack: Notify,
}

#[derive(Default)]
pub(super) struct Inner {
    pub(super) client: Option<ClientSlot>,
    pub(super) idle_timer: Option<JoinHandle<()>>,
    initialize_result: Option<Value>,
    awaiting_shutdown_ack: bool,
    /// Set once by the shutdown that owns this handle; nothing attaches or
    /// arms a timer after it.
    pub(super) closing: bool,
}

/// The attached editor session, identified so a replaced session's teardown
/// cannot detach its successor.
pub(crate) struct ClientSlot {
    pub(crate) id: u64,
    /// A failed send means the socket already went away; it is ignored.
    events: mpsc::UnboundedSender<ClientEvent>,
    /// Server messages held back while a reconnecting session replays its
    /// handshake from the cache; `None` once it is live.
    held: Option<Vec<String>>,
}

impl ClientSlot {
    pub(crate) fn new(
        id: u64,
        events: mpsc::UnboundedSender<ClientEvent>,
        replaying: bool,
    ) -> Self {
        Self {
            id,
            events,
            held: replaying.then(Vec::new),
        }
    }

    fn deliver(&mut self, message: String) {
        match &mut self.held {
            Some(held) => held.push(message),
            None => {
                let _ = self.events.send(ClientEvent::Message(message)); /* expected */
            }
        }
    }

    pub(crate) fn close(self, code: u16, reason: &'static str) {
        let _ = self.events.send(ClientEvent::Close { code, reason }); /* expected */
    }
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock_recover()
    }

    /// Routes one message from the server's stdout.
    pub(super) fn route(&self, message: String) {
        let (want_ack, want_initialize) = {
            let inner = self.lock();
            (
                inner.awaiting_shutdown_ack,
                inner.initialize_result.is_none(),
            )
        };
        let parsed = if want_ack || want_initialize {
            serde_json::from_str::<Value>(&message).ok()
        } else {
            None
        };
        let mut inner = self.lock();
        if let Some(value) = &parsed {
            if want_ack && value.get("id").and_then(Value::as_str) == Some(SHUTDOWN_REQUEST_ID) {
                inner.awaiting_shutdown_ack = false;
                self.shutdown_ack.notify_one();
                return;
            }
            if inner.initialize_result.is_none()
                && let Some(result) = initialize_result(value)
            {
                inner.initialize_result = Some(result);
                tracing::info!("cached LSP initialize result");
            }
        }
        if let Some(client) = &mut inner.client {
            client.deliver(message);
        }
    }
}

/// The `result` of an `initialize` response: the one result that carries
/// `capabilities`.
fn initialize_result(message: &Value) -> Option<Value> {
    let result = message.get("result")?;
    result.get("capabilities").is_some().then(|| result.clone())
}

impl LspServerHandle {
    pub(super) fn lock(&self) -> MutexGuard<'_, Inner> {
        self.shared.lock()
    }

    /// Marks the handle closing and takes its session and idle timer, or
    /// returns `None` when it was already closing.
    pub(super) fn begin_close(&self) -> Option<(Option<ClientSlot>, Option<JoinHandle<()>>)> {
        let mut inner = self.lock();
        if std::mem::replace(&mut inner.closing, true) {
            return None;
        }
        Some((inner.client.take(), inner.idle_timer.take()))
    }

    pub(crate) fn language(&self) -> &str {
        &self.language
    }

    pub(crate) fn initialize_result(&self) -> Option<Value> {
        self.lock().initialize_result.clone()
    }

    /// Sends a client message to the server, waiting for queue room.
    pub(crate) async fn write(&self, json: &str) -> Result<(), StdinWriteError> {
        self.stdin.write(framing::encode(json)).await
    }

    /// Queues a shutdown-handshake message without waiting: a server that
    /// stopped reading stdin must not hold the shutdown.
    pub(super) fn try_write(&self, json: &str) -> Result<(), StdinWriteError> {
        self.stdin.try_write(framing::encode(json))
    }

    pub(super) fn expect_shutdown_ack(&self) {
        self.lock().awaiting_shutdown_ack = true;
    }

    pub(super) async fn shutdown_acked(&self) {
        self.shared.shutdown_ack.notified().await;
    }

    /// Sends `message` to session `id` if it is still the attached one.
    pub(crate) fn send_to_client(&self, id: u64, message: String) {
        if let Some(client) = self.lock().client.as_mut().filter(|c| c.id == id) {
            let _ = client.events.send(ClientEvent::Message(message)); /* expected */
        }
    }

    /// Ends session `id`'s handshake replay, delivering what the server sent
    /// meanwhile in order.
    pub(crate) fn go_live(&self, id: u64) {
        let mut inner = self.lock();
        let Some(client) = inner.client.as_mut().filter(|c| c.id == id) else {
            return;
        };
        for message in client.held.take().unwrap_or_default() {
            let _ = client.events.send(ClientEvent::Message(message)); /* expected */
        }
    }

    #[cfg(test)]
    pub(crate) fn has_idle_timer(&self) -> bool {
        self.lock().idle_timer.is_some()
    }

    #[cfg(test)]
    pub(crate) fn held_messages(&self) -> usize {
        let inner = self.lock();
        inner
            .client
            .as_ref()
            .and_then(|c| c.held.as_ref())
            .map_or(0, Vec::len)
    }

    #[cfg(test)]
    pub(crate) fn exited(&self) -> bool {
        self.process.exit().exited()
    }
}
