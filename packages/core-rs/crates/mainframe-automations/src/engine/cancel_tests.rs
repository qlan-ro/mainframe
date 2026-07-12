//! T4.1/A8 — cancellation is authoritative: one-transaction finalize +
//! interaction cancel, agent-wait cleanup, aborted in-flight walk, and no
//! resurrection by a late agent completion (Node parity:
//! engine-cancel.test.ts, written against a stubbed wait registry until the
//! agent port lands in T4.3).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::domain::{AskAgentStep, AskMeStep, NotifyStep, RunActionStep};
use crate::error::StoreError;
use crate::store::{InteractionStatus, RunStatus, RunStore, StepStatus, TerminalStatus};

use super::advance::{AgentWaitRegistry, Interpreter};
use super::test_support::{
    FakePorts, ask_agent_step, ask_me_step, completed, definition, empty_outputs, harness, manual,
    notify_step, text,
};
use super::{BoxFuture, StepOutcome, VerbContext, VerbPorts};

#[derive(Default)]
struct StubWaits {
    /// chatId -> (runId, stepRef), the shape the real registry keys on.
    waits: Mutex<HashMap<String, (String, String)>>,
    cleared: Mutex<Vec<String>>,
}

impl StubWaits {
    fn find_by_run(&self, run_id: &str) -> Option<String> {
        self.waits
            .lock()
            .unwrap()
            .iter()
            .find(|(_, (rid, _))| rid == run_id)
            .map(|(chat_id, _)| chat_id.clone())
    }
}

impl AgentWaitRegistry for StubWaits {
    fn clear_for_run(&self, run_id: &str) {
        self.waits
            .lock()
            .unwrap()
            .retain(|_, (rid, _)| rid != run_id);
        self.cleared.lock().unwrap().push(run_id.to_string());
    }
}

#[tokio::test]
async fn cancel_run_finalizes_cancelled_and_cancels_pending_interactions() {
    let h = harness().await;
    let ports = FakePorts {
        ask_me: Box::new(|_, _| StepOutcome::Wait { wake_at: None }),
        ..FakePorts::default()
    };
    let engine = h.interpreter(ports);
    let def = definition(vec![ask_me_step("ask-1")]);
    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    let interaction = h
        .interactions
        .create(&run.id, "ask-1", "Pick", vec![])
        .await
        .unwrap();
    assert_eq!(interaction.status, InteractionStatus::Pending);

    engine.cancel_run(&run.id).await.unwrap();

    assert_eq!(
        h.store.get_run(&run.id).await.unwrap().unwrap().status,
        RunStatus::Cancelled
    );
    assert_eq!(
        h.interactions
            .get(&interaction.id)
            .await
            .unwrap()
            .unwrap()
            .status,
        InteractionStatus::Cancelled
    );
    let updates = h.sink.run_updates();
    assert_eq!(updates.last().unwrap().status, RunStatus::Cancelled);

    // Double-cancel is a silent no-op, not an error.
    engine.cancel_run(&run.id).await.unwrap();
}

/// run_action never resolves — the walk must be aborted by cancel_run, not
/// awaited to completion.
struct HangingPorts {
    notify_calls: Arc<Mutex<Vec<String>>>,
}

impl VerbPorts for HangingPorts {
    fn ask_agent<'a>(
        &'a self,
        _step: &'a AskAgentStep,
        _ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        unreachable!("unexpected call to VerbPorts.ask_agent")
    }

    fn ask_me<'a>(
        &'a self,
        _step: &'a AskMeStep,
        _ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        unreachable!("unexpected call to VerbPorts.ask_me")
    }

    fn run_action<'a>(
        &'a self,
        _step: &'a RunActionStep,
        _ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        Box::pin(std::future::pending())
    }

    fn notify<'a>(
        &'a self,
        step: &'a NotifyStep,
        _ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        self.notify_calls.lock().unwrap().push(step.id.clone());
        Box::pin(async move {
            StepOutcome::Completed {
                outputs: empty_outputs(),
            }
        })
    }
}

#[tokio::test]
async fn cancel_aborts_the_in_flight_walk_and_the_run_never_continues() {
    let h = harness().await;
    let notify_calls = Arc::new(Mutex::new(Vec::new()));
    let engine = Arc::new(h.interpreter(HangingPorts {
        notify_calls: notify_calls.clone(),
    }));
    let def = definition(vec![
        super::test_support::run_action_step("run-1", "slow-op", true),
        notify_step("notify-1", vec![text("should never run")]),
    ]);
    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();

    let spawned = engine.clone();
    let run_id = run.id.clone();
    let advance = tokio::spawn(async move { spawned.advance(&run_id).await });

    // Wait for the pre-effect running marker so the walk is provably in-flight.
    for _ in 0..200 {
        let status = h
            .store
            .get_run(&run.id)
            .await
            .unwrap()
            .unwrap()
            .checkpoint
            .steps
            .get("run-1")
            .map(|e| e.status);
        if status == Some(StepStatus::Running) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(2)).await;
    }

    engine.cancel_run(&run.id).await.unwrap();
    advance.await.unwrap().unwrap();

    assert_eq!(
        h.store.get_run(&run.id).await.unwrap().unwrap().status,
        RunStatus::Cancelled
    );
    assert!(notify_calls.lock().unwrap().is_empty());
}

/// The verb itself finalizes the run mid-walk (the shape of a cancel racing
/// the walk's own commit) — the A8 store guard must reject the late commit
/// and the walk must stop without clobbering `cancelled`.
struct FinalizingPorts {
    store: RunStore,
    notify_calls: Arc<Mutex<Vec<String>>>,
}

impl VerbPorts for FinalizingPorts {
    fn ask_agent<'a>(
        &'a self,
        _step: &'a AskAgentStep,
        _ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        unreachable!("unexpected call to VerbPorts.ask_agent")
    }

    fn ask_me<'a>(
        &'a self,
        _step: &'a AskMeStep,
        _ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        unreachable!("unexpected call to VerbPorts.ask_me")
    }

    fn run_action<'a>(
        &'a self,
        _step: &'a RunActionStep,
        ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        Box::pin(async move {
            self.store
                .finalize(ctx.run_id, TerminalStatus::Cancelled, None)
                .await
                .unwrap();
            StepOutcome::Completed {
                outputs: empty_outputs(),
            }
        })
    }

    fn notify<'a>(
        &'a self,
        step: &'a NotifyStep,
        _ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        self.notify_calls.lock().unwrap().push(step.id.clone());
        Box::pin(async move {
            StepOutcome::Completed {
                outputs: empty_outputs(),
            }
        })
    }
}

#[tokio::test]
async fn a_commit_after_cancellation_is_rejected_and_never_clobbers_the_run() {
    let h = harness().await;
    let notify_calls = Arc::new(Mutex::new(Vec::new()));
    let engine = h.interpreter(FinalizingPorts {
        store: h.store.clone(),
        notify_calls: notify_calls.clone(),
    });
    let def = definition(vec![
        super::test_support::run_action_step("run-1", "raced-op", true),
        notify_step("notify-1", vec![text("should never run")]),
    ]);
    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    assert_eq!(
        h.store.get_run(&run.id).await.unwrap().unwrap().status,
        RunStatus::Cancelled
    );
    assert!(notify_calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_late_agent_completion_cannot_resurrect_a_cancelled_run() {
    let h = harness().await;
    let waits = Arc::new(StubWaits::default());
    let register = waits.clone();
    let notify_calls = Arc::new(Mutex::new(Vec::<String>::new()));
    let notified = notify_calls.clone();
    let ports = FakePorts {
        ask_agent: Box::new(move |_, ctx| {
            register.waits.lock().unwrap().insert(
                "chat-1".to_string(),
                (ctx.run_id.to_string(), ctx.step_ref.to_string()),
            );
            StepOutcome::Wait { wake_at: None }
        }),
        notify: Box::new(move |step, _| {
            notified.lock().unwrap().push(step.id.clone());
            completed(empty_outputs())
        }),
        ..FakePorts::default()
    };
    let mut deps = h.deps(ports);
    deps.agent_waits = Some(waits.clone());
    let engine = Interpreter::new(deps);
    let def = definition(vec![
        ask_agent_step("agent-1", false),
        notify_step("notify-1", vec![text("should never run")]),
    ]);
    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();
    assert_eq!(waits.find_by_run(&run.id).as_deref(), Some("chat-1"));

    engine.cancel_run(&run.id).await.unwrap();

    // The wait registration is gone, in the same cancel pass.
    assert!(waits.find_by_run(&run.id).is_none());
    assert_eq!(*waits.cleared.lock().unwrap(), vec![run.id.clone()]);

    // A waker that somehow still tried anyway: the checkpoint write is
    // rejected (A8) and a re-advance is a no-op.
    let write = h
        .store
        .patch_checkpoint(&run.id, |cp| {
            if let Some(entry) = cp.steps.get_mut("agent-1") {
                entry.status = StepStatus::Succeeded;
            }
        })
        .await;
    assert!(matches!(write, Err(StoreError::TerminalRun { .. })));
    engine.advance(&run.id).await.unwrap();

    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Cancelled);
    assert_eq!(
        finished.checkpoint.steps["agent-1"].status,
        StepStatus::Waiting
    );
    assert!(notify_calls.lock().unwrap().is_empty());
}
