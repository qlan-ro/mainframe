//! A recording, controllable `AgentPort`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use mainframe_types::BoxFuture;
use mainframe_types::sync::LockExt as _;
use tokio::sync::mpsc;

use crate::ports::{AgentHandle, AgentOutcome, AgentPort, AgentPortError, AgentRequest};

type OutcomeResult = Result<AgentOutcome, AgentPortError>;

struct Chan {
    tx: mpsc::UnboundedSender<OutcomeResult>,
    rx: tokio::sync::Mutex<mpsc::UnboundedReceiver<OutcomeResult>>,
}

/// Started chats are numbered `chat-1`, `chat-2`, …. By default `watch` and
/// `retry` block on a per-chat channel until the test delivers
/// `complete(...)`, the control a cancel or durable-restart scenario needs;
/// `completing(...)` instead resolves every watch at once with one outcome.
#[derive(Default)]
pub struct FakeAgentPort {
    pub started: Mutex<Vec<AgentRequest>>,
    pub watch_calls: Mutex<Vec<String>>,
    pub retry_calls: Mutex<Vec<(String, String)>>,
    pub cancels: Mutex<Vec<String>>,
    /// When set, `start` fails with this message (after recording the request).
    pub start_error: Mutex<Option<String>>,
    chat_seq: AtomicUsize,
    auto: Mutex<Option<OutcomeResult>>,
    chats: Mutex<HashMap<String, Arc<Chan>>>,
}

impl FakeAgentPort {
    /// `watch` completes at once with `final_text`: the run flows straight
    /// through every agent step.
    pub fn completing(final_text: &str) -> Self {
        let port = Self::default();
        *port.auto.lock_recover() = Some(Ok(AgentOutcome::Completed {
            final_text: final_text.to_string(),
        }));
        port
    }

    /// `watch` blocks until `complete(...)`; used to hold a run at a wait.
    pub fn manual() -> Self {
        Self::default()
    }

    /// Every `start` fails with `message`: a run never gets an agent chat.
    pub fn failing_start(message: &str) -> Self {
        let port = Self::default();
        *port.start_error.lock_recover() = Some(message.to_string());
        port
    }

    /// Delivers the next watch/retry outcome for a chat.
    pub fn complete(&self, chat_id: &str, outcome: OutcomeResult) {
        if self.chan(chat_id).tx.send(outcome).is_err() {
            // Unreachable: the receiver lives in the same `Chan` as the sender.
            tracing::warn!(chat_id, "fake agent port: watch channel closed");
        }
    }

    pub fn started_requests(&self) -> Vec<AgentRequest> {
        self.started.lock_recover().clone()
    }

    pub fn start_count(&self) -> usize {
        self.started.lock_recover().len()
    }

    /// Offsets a second engine's chat-id counter so its freshly started chats
    /// never collide with a chat id it resumed from the first engine's
    /// checkpoint (mid-Repeat restart).
    pub fn seed_chat_seq(&self, start: usize) {
        self.chat_seq.store(start, Ordering::SeqCst);
    }

    fn chan(&self, chat_id: &str) -> Arc<Chan> {
        self.chats
            .lock_recover()
            .entry(chat_id.to_string())
            .or_insert_with(|| {
                let (tx, rx) = mpsc::unbounded_channel();
                Arc::new(Chan {
                    tx,
                    rx: tokio::sync::Mutex::new(rx),
                })
            })
            .clone()
    }

    async fn next_outcome(&self, chat_id: &str) -> OutcomeResult {
        let auto = self.auto.lock_recover().clone();
        if let Some(outcome) = auto {
            return outcome;
        }
        let chan = self.chan(chat_id);
        let mut rx = chan.rx.lock().await;
        rx.recv()
            .await
            .unwrap_or_else(|| Err(AgentPortError("watch channel closed".to_string())))
    }
}

impl AgentPort for FakeAgentPort {
    fn start(&self, request: AgentRequest) -> BoxFuture<'_, Result<AgentHandle, AgentPortError>> {
        self.started.lock_recover().push(request);
        if let Some(message) = self.start_error.lock_recover().clone() {
            return Box::pin(async move { Err(AgentPortError(message)) });
        }
        let n = self.chat_seq.fetch_add(1, Ordering::SeqCst) + 1;
        Box::pin(async move {
            Ok(AgentHandle {
                chat_id: format!("chat-{n}"),
            })
        })
    }

    fn watch<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, OutcomeResult> {
        self.watch_calls.lock_recover().push(chat_id.to_string());
        Box::pin(self.next_outcome(chat_id))
    }

    fn retry<'a>(&'a self, chat_id: &'a str, correction: &'a str) -> BoxFuture<'a, OutcomeResult> {
        self.retry_calls
            .lock_recover()
            .push((chat_id.to_string(), correction.to_string()));
        Box::pin(self.next_outcome(chat_id))
    }

    fn cancel<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, Result<(), AgentPortError>> {
        self.cancels.lock_recover().push(chat_id.to_string());
        Box::pin(async { Ok(()) })
    }
}
