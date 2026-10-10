//! Agent-flow test rig: the VerbPorts wiring that routes ask_agent through a
//! real AgentVerb over the testkit's controllable `FakeAgentPort`.

use std::sync::Arc;
use std::time::Duration;

use crate::domain::{AskAgentStep, AskMeStep, NotifyStep, RunActionStep};
use crate::store::{RunRecord, RunStore};
pub(crate) use crate::testkit::FakeAgentPort;

use super::advance::Interpreter;
use super::agent::AgentVerb;
use super::test_support::{FakePorts, Harness, harness};
use super::{BoxFuture, StepOutcome, VerbContext, VerbPorts};

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
    let verb = AgentVerb::new(port.clone(), h.store.clone());
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
