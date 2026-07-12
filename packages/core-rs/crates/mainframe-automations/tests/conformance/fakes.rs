//! Fake ports for the conformance harness (T10.2). These implement the real
//! public port traits, so the suite drives the genuine `AutomationsEngine`
//! facade — only the outside world (chats, notifications, the event bus) is
//! faked. Recording fakes let each scenario assert what actually reached a
//! boundary.
#![allow(dead_code)]

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

use chrono::{DateTime, FixedOffset};
use tokio::sync::mpsc;

use mainframe_automations::engine::BoxFuture;
use mainframe_automations::ports::{
    AgentHandle, AgentOutcome, AgentPort, AgentPortError, AgentRequest, AutomationEvent, Clock,
    EventSink, InteractionSummary, Notification, Notifier, NotifyError, ProjectRegistry,
    RunSummary,
};

/// A frozen clock so the `today`/`now` builtins are deterministic: fixtures
/// that stamp `⟨Today⟩` render `2026-07-12`.
pub struct FakeClock;

impl Clock for FakeClock {
    fn now(&self) -> DateTime<FixedOffset> {
        DateTime::parse_from_rfc3339("2026-07-12T10:00:00+00:00").unwrap()
    }
}

/// Captures every engine event so a scenario can assert an interaction row was
/// created, or a completion fanned out.
#[derive(Default)]
pub struct CollectingSink {
    events: Mutex<Vec<AutomationEvent>>,
}

impl EventSink for CollectingSink {
    fn emit(&self, event: AutomationEvent) {
        self.events.lock().unwrap().push(event);
    }
}

impl CollectingSink {
    pub fn interactions_created(&self) -> Vec<InteractionSummary> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                AutomationEvent::InteractionCreated { interaction } => Some(interaction.clone()),
                _ => None,
            })
            .collect()
    }

    pub fn run_updates(&self) -> Vec<RunSummary> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                AutomationEvent::RunUpdated { run } => Some(run.clone()),
                _ => None,
            })
            .collect()
    }
}

/// Records every notification the notify verb / form pause pushed.
#[derive(Default)]
pub struct FakeNotifier {
    pub sent: Mutex<Vec<Notification>>,
}

impl Notifier for FakeNotifier {
    fn notify(&self, notification: Notification) -> BoxFuture<'_, Result<(), NotifyError>> {
        self.sent.lock().unwrap().push(notification);
        Box::pin(async { Ok(()) })
    }
}

impl FakeNotifier {
    pub fn bodies(&self) -> Vec<String> {
        self.sent
            .lock()
            .unwrap()
            .iter()
            .map(|n| n.body.clone())
            .collect()
    }
}

/// A fixed containment root (a tempdir); run_action never actually touches it
/// because the actions are faked.
pub struct FixedProjects(pub String);

impl ProjectRegistry for FixedProjects {
    fn resolve_project_root<'a>(&'a self, _project_id: Option<&'a str>) -> BoxFuture<'a, String> {
        let root = self.0.clone();
        Box::pin(async move { root })
    }
}

type OutcomeResult = Result<AgentOutcome, AgentPortError>;

struct Chan {
    tx: mpsc::UnboundedSender<OutcomeResult>,
    rx: tokio::sync::Mutex<mpsc::UnboundedReceiver<OutcomeResult>>,
}

/// A recording chat port. In `auto` mode `watch` resolves immediately with the
/// configured outcome (the common conformance path); otherwise it blocks on a
/// per-chat channel until the test delivers `complete(...)` — the control a
/// cancel / durable-restart scenario needs.
#[derive(Default)]
pub struct FakeAgentPort {
    pub started: Mutex<Vec<AgentRequest>>,
    pub cancels: Mutex<Vec<String>>,
    chat_seq: AtomicUsize,
    auto: Mutex<Option<OutcomeResult>>,
    chats: Mutex<HashMap<String, std::sync::Arc<Chan>>>,
}

impl FakeAgentPort {
    /// `watch` completes at once with `final_text` — the run flows straight
    /// through the agent step.
    pub fn completing(final_text: &str) -> Self {
        let port = Self::default();
        *port.auto.lock().unwrap() = Some(Ok(AgentOutcome::Completed {
            final_text: final_text.to_string(),
        }));
        port
    }

    /// `watch` blocks until `complete(...)`; used to hold a run at a wait.
    pub fn manual() -> Self {
        Self::default()
    }

    pub fn complete(&self, chat_id: &str, outcome: OutcomeResult) {
        self.chan(chat_id).tx.send(outcome).unwrap();
    }

    pub fn started_requests(&self) -> Vec<AgentRequest> {
        self.started.lock().unwrap().clone()
    }

    pub fn start_count(&self) -> usize {
        self.started.lock().unwrap().len()
    }

    /// Offsets a second engine's chat-id counter so its freshly started chats
    /// never collide with a chat id it resumed from the first engine's
    /// checkpoint (mid-Repeat restart).
    pub fn seed_chat_seq(&self, start: usize) {
        self.chat_seq.store(start, Ordering::SeqCst);
    }

    fn chan(&self, chat_id: &str) -> std::sync::Arc<Chan> {
        self.chats
            .lock()
            .unwrap()
            .entry(chat_id.to_string())
            .or_insert_with(|| {
                let (tx, rx) = mpsc::unbounded_channel();
                std::sync::Arc::new(Chan {
                    tx,
                    rx: tokio::sync::Mutex::new(rx),
                })
            })
            .clone()
    }

    async fn next_outcome(&self, chat_id: &str) -> OutcomeResult {
        if let Some(outcome) = self.auto.lock().unwrap().clone() {
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
        self.started.lock().unwrap().push(request);
        let n = self.chat_seq.fetch_add(1, Ordering::SeqCst) + 1;
        Box::pin(async move {
            Ok(AgentHandle {
                chat_id: format!("chat-{n}"),
            })
        })
    }

    fn watch<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, OutcomeResult> {
        Box::pin(self.next_outcome(chat_id))
    }

    fn retry<'a>(&'a self, chat_id: &'a str, _correction: &'a str) -> BoxFuture<'a, OutcomeResult> {
        Box::pin(self.next_outcome(chat_id))
    }

    fn cancel<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, Result<(), AgentPortError>> {
        self.cancels.lock().unwrap().push(chat_id.to_string());
        Box::pin(async { Ok(()) })
    }
}
