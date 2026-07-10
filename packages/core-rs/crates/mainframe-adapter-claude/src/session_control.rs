//! Ported from `packages/core/src/plugins/builtin/claude/session-control.ts`.
//!
//! One correlation channel per session for `control_request`/`control_response`
//! round-trips. Fire-and-forget callers use [`ControlRequestChannel::send`];
//! awaiting callers use [`ControlRequestChannel::send_awaiting`]. A single pending
//! map is drained by `events.rs` via [`ControlRequestChannel::resolve`], and by
//! session close via [`ControlRequestChannel::drain_all_as_failed`].

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use nanoid::nanoid;
use serde_json::{Value, json};
use tokio::sync::{mpsc, oneshot};

/// `Raw = Record<string, unknown> | undefined` — a control_response object, or
/// absent (timeout / drained).
pub type Raw = Option<Value>;

/// The stdin write handle the session hands to `send`/`send_awaiting`. Mirrors
/// the TS `ChildProcess['stdin']` argument (nullable when the process is gone):
/// bytes are pushed to the session's stdin writer task, sync fire-and-forget.
pub type StdinTx = mpsc::UnboundedSender<Vec<u8>>;

/// When provided, `resolve` fulfills only on a response the predicate accepts —
/// intermediate acks are ignored.
type TerminalPred = Box<dyn Fn(&Raw) -> bool + Send + Sync>;

struct Pending {
    is_terminal: Option<TerminalPred>,
    done: oneshot::Sender<Raw>,
}

/// Options for [`ControlRequestChannel::send_awaiting`], mirroring the TS `opts`.
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
    /// The TS constructor takes a `Logger`; the Rust port logs through the global
    /// `tracing` subscriber, so only the `sessionId` (carried on every log) is kept.
    pub fn new(session_id: String) -> Self {
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
            session_id,
        }
    }

    pub fn send(&self, stdin: Option<&StdinTx>, request: &Value) -> String {
        let request_id = nanoid!();
        if let Some(tx) = stdin {
            let mut line = serde_json::to_string(&json!({
                "type": "control_request",
                "request_id": request_id,
                "request": request,
            }))
            .unwrap_or_default();
            line.push('\n');
            let _ = tx.send(line.into_bytes());
        }
        request_id
    }

    pub async fn send_awaiting(
        &self,
        stdin: Option<&StdinTx>,
        request: &Value,
        opts: SendAwaitingOpts,
    ) -> Raw {
        let request_id = self.send(stdin, request);
        let (tx, rx) = oneshot::channel();
        self.pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(
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
                self.pending
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&request_id);
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
        let mut pending = self.pending.lock().unwrap_or_else(|e| e.into_inner());
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
    pub fn drain_all_as_failed(&self) {
        let drained: Vec<Pending> = self
            .pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .drain()
            .map(|(_, entry)| entry)
            .collect();
        for entry in drained {
            let _ = entry.done.send(None);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read_request_id(rx: &mut mpsc::UnboundedReceiver<Vec<u8>>) -> String {
        let bytes = rx.try_recv().expect("a control_request was written");
        let written: Value = serde_json::from_slice(&bytes).unwrap();
        written["request_id"].as_str().unwrap().to_string()
    }

    #[tokio::test]
    async fn correlates_a_response_to_its_awaiting_caller_by_request_id() {
        let ch = ControlRequestChannel::new("s1".to_string());
        let (tx, mut rx) = mpsc::unbounded_channel();
        let request = json!({ "subtype": "set_model", "model": "x" });
        let opts = SendAwaitingOpts {
            label: "set_model".to_string(),
            timeout_ms: Some(1000),
            is_terminal: None,
        };
        let (result, ()) = tokio::join!(ch.send_awaiting(Some(&tx), &request, opts), async {
            let request_id = read_request_id(&mut rx);
            assert!(ch.resolve(&request_id, Some(json!({ "subtype": "success" }))));
        });
        assert_eq!(result, Some(json!({ "subtype": "success" })));
    }

    #[tokio::test]
    async fn resolves_undefined_on_timeout() {
        let ch = ControlRequestChannel::new("s1".to_string());
        let result = ch
            .send_awaiting(
                None,
                &json!({ "subtype": "x" }),
                SendAwaitingOpts {
                    label: "x".to_string(),
                    timeout_ms: Some(10),
                    is_terminal: None,
                },
            )
            .await;
        assert_eq!(result, None);
    }

    #[tokio::test]
    async fn ignores_a_non_terminal_ack_then_resolves_on_the_terminal_shape() {
        let ch = ControlRequestChannel::new("s1".to_string());
        let (tx, mut rx) = mpsc::unbounded_channel();
        let request = json!({ "subtype": "cancel_async_message" });
        let opts = SendAwaitingOpts {
            label: "cancel_async_message".to_string(),
            timeout_ms: Some(5000),
            is_terminal: Some(Box::new(|r: &Raw| {
                r.as_ref()
                    .and_then(|v| v.get("cancelled"))
                    .map(Value::is_boolean)
                    .unwrap_or(false)
            })),
        };
        let (result, ()) = tokio::join!(ch.send_awaiting(Some(&tx), &request, opts), async {
            let request_id = read_request_id(&mut rx);
            // intermediate — caller keeps waiting
            assert!(!ch.resolve(&request_id, Some(json!({ "ack": true }))));
            assert!(ch.resolve(&request_id, Some(json!({ "cancelled": true }))));
        });
        assert_eq!(result, Some(json!({ "cancelled": true })));
    }

    #[tokio::test]
    async fn drain_all_as_failed_resolves_every_pending_caller_with_undefined() {
        let ch = ControlRequestChannel::new("s1".to_string());
        let opts = SendAwaitingOpts {
            label: "x".to_string(),
            timeout_ms: Some(10_000),
            is_terminal: None,
        };
        let request = json!({ "subtype": "x" });
        let (result, ()) = tokio::join!(ch.send_awaiting(None, &request, opts), async {
            ch.drain_all_as_failed();
        });
        assert_eq!(result, None);
    }
}

// PORT STATUS: src/plugins/builtin/claude/session-control.ts (76 lines)
// confidence: high
// todos: 0
// notes: pending is Arc<Mutex<HashMap<RequestId, Pending>>> per CONCURRENCY.tsv
// notes: (session-control.ts:pending → SHARED_MAP, leaf below the session handle).
// notes: sendAwaiting uses oneshot + tokio::time::timeout; the isTerminal predicate
// notes: rides on the Pending entry so resolve() can reject intermediate acks. The
// notes: TS `stdin` (ChildProcess['stdin']) becomes Option<&StdinTx> — an mpsc byte
// notes: sender to the session's stdin writer task (codex jsonrpc house style), so
// notes: send/send_awaiting stay sync fire-and-forget. Logger arg dropped (tracing
// notes: is global; sessionId retained on the warn). Tests ported assertion-for-
// notes: assertion (fake vi.fn stdin → an mpsc receiver read for the request_id).
