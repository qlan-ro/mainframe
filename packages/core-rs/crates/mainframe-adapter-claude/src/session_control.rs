//! One correlation channel per session for `control_request`/`control_response`
//! round-trips. Fire-and-forget callers use [`ControlRequestChannel::send`];
//! awaiting callers use [`ControlRequestChannel::send_awaiting`]. A single pending
//! map is drained by `events.rs` via [`ControlRequestChannel::resolve`], and by
//! session close via [`ControlRequestChannel::drain_all_as_failed`].

use mainframe_types::sync::LockExt;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use nanoid::nanoid;
use serde_json::{Value, json};
use tokio::sync::oneshot;

/// `Raw = Record<string, unknown> | undefined` — a control_response object, or
/// absent (timeout / drained).
pub type Raw = Option<Value>;

/// The stdin write handle the session hands to `send`/`send_awaiting` (`None`
/// when the process is gone): bytes are queued for the session's stdin writer
/// task without waiting, so a full queue is reported rather than buffered.
pub type StdinTx = mainframe_runtime::process::StdinWriter;
pub use mainframe_runtime::process::StdinWriteError;

/// When provided, `resolve` fulfills only on a response the predicate accepts —
/// intermediate acks are ignored.
type TerminalPred = Box<dyn Fn(&Raw) -> bool + Send + Sync>;

struct Pending {
    is_terminal: Option<TerminalPred>,
    done: oneshot::Sender<Raw>,
}

/// Options for [`ControlRequestChannel::send_awaiting`].
pub struct SendAwaitingOpts {
    pub label: String,
    pub timeout_ms: Option<u64>,
    pub is_terminal: Option<TerminalPred>,
}

pub struct ControlRequestChannel {
    pending: Arc<Mutex<HashMap<String, Pending>>>,
    session_id: String,
}

impl ControlRequestChannel {
    /// Logs go through the global `tracing` subscriber, so only the `sessionId`
    /// (carried on every log) is kept.
    pub fn new(session_id: String) -> Self {
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
            session_id,
        }
    }

    /// Queue a `control_request`; the id to correlate its response with. A
    /// missing stdin still yields an id (the caller's await then times out);
    /// a closed or full queue is the error.
    pub fn send(
        &self,
        stdin: Option<&StdinTx>,
        request: &Value,
    ) -> Result<String, StdinWriteError> {
        let request_id = nanoid!();
        if let Some(tx) = stdin {
            let mut line = serde_json::to_string(&json!({
                "type": "control_request",
                "request_id": request_id,
                "request": request,
            }))
            .unwrap_or_default();
            line.push('\n');
            tx.try_write(line.into_bytes())?;
        }
        Ok(request_id)
    }

    pub(crate) async fn send_awaiting(
        &self,
        stdin: Option<&StdinTx>,
        request: &Value,
        opts: SendAwaitingOpts,
    ) -> Raw {
        let request_id = match self.send(stdin, request) {
            Ok(request_id) => request_id,
            Err(error) => {
                tracing::warn!(
                    session_id = %self.session_id,
                    label = %opts.label,
                    %error,
                    "{} control_request not written",
                    opts.label
                );
                return None;
            }
        };
        let (tx, rx) = oneshot::channel();
        self.pending.lock_recover().insert(
            request_id.clone(),
            Pending {
                is_terminal: opts.is_terminal,
                done: tx,
            },
        );

        let timeout = Duration::from_millis(opts.timeout_ms.unwrap_or(5_000));
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(raw)) => raw,
            // Sender dropped without sending (drainAllAsFailed already ran, or the
            // entry was removed) — the caller treats this as failure, like undefined.
            Ok(Err(_)) => None,
            Err(_) => {
                self.pending.lock_recover().remove(&request_id);
                tracing::warn!(
                    session_id = %self.session_id,
                    request_id = %request_id,
                    label = %opts.label,
                    "{} control_response timed out",
                    opts.label
                );
                None
            }
        }
    }

    /// Route a control_response to its awaiting caller. Returns false when unmatched
    /// (e.g. context-usage) or when the response is a non-terminal intermediate ack
    /// the caller's predicate rejects — in that case the caller keeps waiting.
    pub fn resolve(&self, request_id: &str, raw: Raw) -> bool {
        let mut pending = self.pending.lock_recover();
        let accepted = match pending.get(request_id) {
            None => return false,
            Some(entry) => match &entry.is_terminal {
                Some(is_terminal) => is_terminal(&raw),
                None => true,
            },
        };
        if !accepted {
            return false; // intermediate ack — keep waiting
        }
        if let Some(entry) = pending.remove(request_id) {
            let _ = entry.done.send(raw);
        }
        true
    }

    /// Fail every pending caller when the session dies, so no awaiter hangs forever.
    pub(crate) fn drain_all_as_failed(&self) {
        let drained: Vec<Pending> = self
            .pending
            .lock_recover()
            .drain()
            .map(|(_, entry)| entry)
            .collect();
        for entry in drained {
            let _ = entry.done.send(None);
        }
    }
}

#[cfg(test)]
#[path = "session_control_tests.rs"]
mod tests;
