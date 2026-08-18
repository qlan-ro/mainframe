//! `find_step_by_id` used to stop at `If`/`Repeat` — a step nested inside a
//! `loop` or `retry` was invisible to every caller that looks it up by id.
//! One regression per caller, all via `retry_step` (the fix is the same
//! two-line match arm regardless of which block finds the step).

use std::sync::Arc;

use serde_json::json;

use crate::domain::{ExpectedOutput, ExpectedOutputType, RunActionStep, Step};
use crate::ports::AgentOutcome;
use crate::store::{CheckpointStep, RunStatus, StepStatus};

use super::advance::{Interpreter, InterpreterDeps};
use super::agent_test_support::{agent_rig, wait_for_run};
use super::test_support::{
    FakePorts, Harness, ask_agent_step, completed, definition, empty_outputs, harness, manual,
    retry_step,
};

fn expecting(step: Step) -> Step {
    match step {
        Step::AskAgent(mut s) => {
            s.expects = Some(vec![ExpectedOutput {
                key: "scope".to_string(),
                output_type: ExpectedOutputType::Choice,
                options: Some(vec!["xs".to_string(), "s".to_string()]),
            }]);
            Step::AskAgent(s)
        }
        _ => unreachable!(),
    }
}

/// `agent_settle.rs::load_waiting_step` looks up `expects` via
/// `find_step_by_id` — nested inside a `retry`, a miss silently drops the
/// A2 output contract instead of failing loudly.
#[tokio::test]
async fn expects_inside_a_retry_still_parses_the_structured_output() {
    let rig = agent_rig(FakePorts::default()).await;
    let def = definition(vec![retry_step(
        "guard",
        1,
        vec![expecting(ask_agent_step("agent", false))],
    )]);
    let run = rig
        .engine
        .start_run(&rig.h.automation_id, def, manual(), None)
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();

    rig.port.complete(
        "chat-1",
        Ok(AgentOutcome::Completed {
            final_text: "{\"scope\": \"s\"}".to_string(),
        }),
    );

    let finished = wait_for_run(&rig.h.store, &run.id, |r| r.status == RunStatus::Succeeded).await;
    let outputs = finished.checkpoint.steps["agent#0"]
        .outputs
        .as_ref()
        .unwrap();
    assert_eq!(
        outputs["scope"],
        json!("s"),
        "expects nested in a retry must still be enforced, not silently dropped"
    );
}

/// `deadline.rs::fail_step` looks up `keepGoing` via `find_step_by_id` —
/// nested inside a `retry`, a miss reads `false` and finalizes the run even
/// when the step itself declared `keepGoing: true`.
#[tokio::test]
async fn keep_going_inside_a_retry_is_honored_by_the_deadline_sweep() {
    let rig = agent_rig(FakePorts::default()).await;
    let step = match ask_agent_step("agent", true) {
        Step::AskAgent(mut s) => {
            s.timeout_minutes = Some(1);
            Step::AskAgent(s)
        }
        _ => unreachable!(),
    };
    let def = definition(vec![retry_step("guard", 1, vec![step])]);
    let run = rig
        .engine
        .start_run(&rig.h.automation_id, def, manual(), None)
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();

    let parked = rig.h.store.get_run(&run.id).await.unwrap().unwrap();
    let wake_at = parked.checkpoint.wake_at.unwrap();
    rig.engine.sweep_due(wake_at + 1).await.unwrap();

    let finished = wait_for_run(&rig.h.store, &run.id, |r| r.status == RunStatus::Succeeded).await;
    assert_eq!(
        finished.checkpoint.steps["agent#0"].status,
        StepStatus::Failed,
        "keepGoing lets the run continue, but the deadline still fails the step itself"
    );
}

fn idempotent_engine(h: &Harness, ports: FakePorts, idempotent: bool) -> Interpreter {
    let mut deps: InterpreterDeps = h.deps(ports);
    deps.is_idempotent = Some(Arc::new(move |_: &RunActionStep| idempotent));
    Interpreter::new(deps)
}

/// Seeds a checkpoint entry under `step_ref` as a previous engine instance
/// would have left it, carrying the PLAIN `step_id` a nested block's ref
/// suffixes off of.
async fn seed_running(h: &Harness, run_id: &str, step_ref: &str, step_id: &str, kind: &str) {
    let (step_ref, step_id, kind) = (step_ref.to_string(), step_id.to_string(), kind.to_string());
    h.store
        .patch_checkpoint(run_id, move |cp| {
            cp.steps.insert(
                step_ref,
                CheckpointStep {
                    step_id,
                    kind,
                    status: StepStatus::Running,
                    outputs: None,
                    error: None,
                    started_at: Some(1),
                    finished_at: None,
                    chat_id: None,
                    interaction_id: None,
                    wake_at: None,
                },
            );
        })
        .await
        .unwrap();
}

/// `advance.rs::resolve_stale_running` looks up idempotency via
/// `find_step_by_id` — nested inside a `retry`, a miss treats a genuinely
/// idempotent action as restart-unsafe and fails the run.
#[tokio::test]
async fn a_stale_running_action_inside_a_retry_reruns_when_idempotent() {
    let h = harness().await;
    let ports = FakePorts {
        run_action: Box::new(|_, _| completed(empty_outputs())),
        ..FakePorts::default()
    };
    let engine = idempotent_engine(&h, ports, true);
    let def = definition(vec![retry_step(
        "guard",
        1,
        vec![Step::RunAction(RunActionStep {
            id: "run-1".to_string(),
            keep_going: false,
            action_id: "idempotent-op".to_string(),
            credential: None,
            params: Default::default(),
            output_as: None,
            output_name: None,
        })],
    )]);
    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    seed_running(&h, &run.id, "run-1#0", "run-1", "run_action").await;

    engine.advance(&run.id).await.unwrap();

    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(
        finished.status,
        RunStatus::Succeeded,
        "an idempotent action nested in a retry must rerun instead of failing the run"
    );
}
