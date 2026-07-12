//! Agent-flow test rig: FakeAgentPort (controllable outcomes per chat) and
//! the VerbPorts wiring that routes ask_agent through a real AgentVerb.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::mpsc;

use crate::domain::{AskAgentStep, AskMeStep, NotifyStep, RunActionStep};
use crate::ports::{AgentHandle, AgentOutcome, AgentPort, AgentPortError, AgentRequest};
use crate::store::{RunRecord, RunStore};

use super::advance::Interpreter;
use super::agent::AgentVerb;
use super::test_support::{FakePorts, Harness, harness};
use super::{BoxFuture, StepOutcome, VerbContext, VerbPorts};

type OutcomeResult = Result<AgentOutcome, AgentPortError>;

struct Chan {
    tx: mpsc::UnboundedSender<OutcomeResult>,
    rx: tokio::sync::Mutex<mpsc::UnboundedReceiver<OutcomeResult>>,
}

#[derive(Default)]
pub(crate) struct FakeAgentPort {
    pub started: Mutex<Vec<AgentRequest>>,
    pub watch_calls: Mutex<Vec<String>>,
    pub retry_calls: Mutex<Vec<(String, String)>>,
    pub cancel_calls: Mutex<Vec<String>>,
    pub start_error: Mutex<Option<String>>,
    chats: Mutex<HashMap<String, Arc<Chan>>>,
    next_chat: AtomicUsize,
}

impl FakeAgentPort {
    fn chan(&self, chat_id: &str) -> Arc<Chan> {
        let mut chats = self.chats.lock().unwrap();
        chats
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

    /// Delivers the next watch/retry outcome for a chat.
    pub fn complete(&self, chat_id: &str, outcome: OutcomeResult) {
        self.chan(chat_id).tx.send(outcome).unwrap();
    }

    async fn next_outcome(&self, chat_id: &str) -> OutcomeResult {
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
        if let Some(message) = self.start_error.lock().unwrap().clone() {
            return Box::pin(async move { Err(AgentPortError(message)) });
        }
        let n = self.next_chat.fetch_add(1, Ordering::SeqCst) + 1;
        Box::pin(async move {
            Ok(AgentHandle {
                chat_id: format!("chat-{n}"),
            })
        })
    }

    fn watch<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, OutcomeResult> {
        self.watch_calls.lock().unwrap().push(chat_id.to_string());
        Box::pin(self.next_outcome(chat_id))
    }

    fn retry<'a>(&'a self, chat_id: &'a str, correction: &'a str) -> BoxFuture<'a, OutcomeResult> {
        self.retry_calls
            .lock()
            .unwrap()
            .push((chat_id.to_string(), correction.to_string()));
        Box::pin(self.next_outcome(chat_id))
    }

    fn cancel<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, Result<(), AgentPortError>> {
        self.cancel_calls.lock().unwrap().push(chat_id.to_string());
        Box::pin(async { Ok(()) })
    }
}

/// VerbPorts that routes ask_agent through a real AgentVerb; the other verbs
/// fall back to FakePorts handlers.
pub(crate) struct AgentWiredPorts {
    pub agent: Arc<AgentVerb>,
    pub fallback: FakePorts,
}

impl VerbPorts for AgentWiredPorts {
    fn ask_agent<'a>(
        &'a self,
        step: &'a AskAgentStep,
        ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        let agent = self.agent.clone();
        Box::pin(async move { agent.execute(step, ctx).await })
    }

    fn ask_me<'a>(
        &'a self,
        step: &'a AskMeStep,
        ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        self.fallback.ask_me(step, ctx)
    }

    fn run_action<'a>(
        &'a self,
        step: &'a RunActionStep,
        ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        self.fallback.run_action(step, ctx)
    }

    fn notify<'a>(
        &'a self,
        step: &'a NotifyStep,
        ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        self.fallback.notify(step, ctx)
    }
}

pub(crate) struct AgentRig {
    pub h: Harness,
    pub port: Arc<FakeAgentPort>,
    /// Kept alive so the wait registry survives the whole test.
    pub _verb: Arc<AgentVerb>,
    pub engine: Arc<Interpreter>,
}

pub(crate) async fn agent_rig(fallback: FakePorts) -> AgentRig {
    let h = harness().await;
    let port: Arc<FakeAgentPort> = Arc::new(FakeAgentPort::default());
    let verb = AgentVerb::new(port.clone(), h.store.clone(), h.sink.clone());
    let ports = AgentWiredPorts {
        agent: verb.clone(),
        fallback,
    };
    let mut deps = h.deps(ports);
    deps.agent_waits = Some(verb.clone());
    let engine = Arc::new(Interpreter::new(deps));
    verb.bind_advancer(engine.clone());
    AgentRig {
        h,
        port,
        _verb: verb,
        engine,
    }
}

/// Polls until the run satisfies `pred` (the agent settle path is a spawned
/// task, so completion is asynchronous even with fakes).
pub(crate) async fn wait_for_run(
    store: &RunStore,
    run_id: &str,
    pred: impl Fn(&RunRecord) -> bool,
) -> RunRecord {
    for _ in 0..400 {
        let run = store.get_run(run_id).await.unwrap().unwrap();
        if pred(&run) {
            return run;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    panic!("run {run_id} never reached the expected state");
}
