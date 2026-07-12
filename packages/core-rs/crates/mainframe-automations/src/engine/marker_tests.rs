//! T4.1 — Decision-12 pre-effect `running` marker + per-run advance
//! serialization (Node parity: engine-linear.test.ts marker/serialize cases).

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::json;

use crate::domain::{AskAgentStep, AskMeStep, NotifyStep, RunActionStep};
use crate::store::{RunStatus, RunStore, StepStatus};

use super::test_support::{
    definition, empty_outputs, harness, manual, notify_step, run_action_step,
};
use super::{BoxFuture, StepOutcome, VerbContext, VerbPorts};

/// Records the step's persisted checkpoint status at the moment each verb
/// port runs, then completes.
struct ObservingPorts {
    store: RunStore,
    seen: Arc<Mutex<Vec<Option<StepStatus>>>>,
}

impl ObservingPorts {
    fn observe<'a>(&'a self, ctx: VerbContext<'a>) -> BoxFuture<'a, StepOutcome> {
        Box::pin(async move {
            let run = self.store.get_run(ctx.run_id).await.unwrap().unwrap();
            let status = run.checkpoint.steps.get(ctx.step_ref).map(|e| e.status);
            self.seen.lock().unwrap().push(status);
            StepOutcome::Completed {
                outputs: [("output".to_string(), json!("ok"))].into_iter().collect(),
            }
        })
    }
}

impl VerbPorts for ObservingPorts {
    fn ask_agent<'a>(
        &'a self,
        _step: &'a AskAgentStep,
        ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        self.observe(ctx)
    }

    fn ask_me<'a>(
        &'a self,
        _step: &'a AskMeStep,
        ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        self.observe(ctx)
    }

    fn run_action<'a>(
        &'a self,
        _step: &'a RunActionStep,
        ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        self.observe(ctx)
    }

    fn notify<'a>(
        &'a self,
        _step: &'a NotifyStep,
        ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        self.observe(ctx)
    }
}

#[tokio::test]
async fn commits_a_running_marker_before_a_non_idempotent_action_then_succeeded() {
    let h = harness().await;
    let seen = Arc::new(Mutex::new(Vec::new()));
    let engine = h.interpreter(ObservingPorts {
        store: h.store.clone(),
        seen: seen.clone(),
    });
    let def = definition(vec![run_action_step("run-1", "noop", false)]);
    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    // The marker was already persisted when the port ran…
    assert_eq!(*seen.lock().unwrap(), vec![Some(StepStatus::Running)]);
    // …and the final commit landed as succeeded.
    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(
        finished.checkpoint.steps["run-1"].status,
        StepStatus::Succeeded
    );
}

#[tokio::test]
async fn no_running_marker_for_ask_me_or_notify() {
    let h = harness().await;
    let seen = Arc::new(Mutex::new(Vec::new()));
    let engine = h.interpreter(ObservingPorts {
        store: h.store.clone(),
        seen: seen.clone(),
    });
    let def = definition(vec![
        super::test_support::ask_me_step("ask-1"),
        notify_step("notify-1", vec![super::test_support::text("hi")]),
    ]);
    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    assert_eq!(*seen.lock().unwrap(), vec![None, None]);
}

/// Sleeps inside the verb so overlapping advances would be observable.
struct SleepyPorts {
    concurrent: Arc<AtomicUsize>,
    max_seen: Arc<AtomicUsize>,
}

impl VerbPorts for SleepyPorts {
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
        unreachable!("unexpected call to VerbPorts.run_action")
    }

    fn notify<'a>(
        &'a self,
        _step: &'a NotifyStep,
        _ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        Box::pin(async move {
            let now = self.concurrent.fetch_add(1, Ordering::SeqCst) + 1;
            self.max_seen.fetch_max(now, Ordering::SeqCst);
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            self.concurrent.fetch_sub(1, Ordering::SeqCst);
            StepOutcome::Completed {
                outputs: empty_outputs(),
            }
        })
    }
}

#[tokio::test]
async fn serializes_concurrent_advance_calls_for_the_same_run() {
    let h = harness().await;
    let max_seen = Arc::new(AtomicUsize::new(0));
    let engine = h.interpreter(SleepyPorts {
        concurrent: Arc::new(AtomicUsize::new(0)),
        max_seen: max_seen.clone(),
    });
    let def = definition(vec![notify_step(
        "notify-1",
        vec![super::test_support::text("x")],
    )]);
    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();

    let (a, b) = tokio::join!(engine.advance(&run.id), engine.advance(&run.id));
    a.unwrap();
    b.unwrap();

    assert_eq!(max_seen.load(Ordering::SeqCst), 1);
    assert_eq!(
        h.store.get_run(&run.id).await.unwrap().unwrap().status,
        RunStatus::Succeeded
    );
}
