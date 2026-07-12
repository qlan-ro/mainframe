//! T4.1 — resume over the same store: replay never re-runs committed steps,
//! and a stranded `running` marker follows the Decision-12 restart policy
//! (Node parity: engine-resume.test.ts).

use std::sync::{Arc, Mutex};

use crate::store::{RunStatus, StepStatus};

use super::advance::Interpreter;
use super::test_support::{
    FakePorts, ask_agent_step, completed, definition, empty_outputs, harness, manual, notify_step,
    run_action_step, text,
};

const RESTART_ERROR: &str = "engine restarted mid-action; effect unknown";

/// Seeds a checkpoint entry as a previous engine instance would have left it.
async fn seed_step(
    h: &super::test_support::Harness,
    run_id: &str,
    step_id: &str,
    kind: &str,
    status: StepStatus,
) {
    let (step_id, kind) = (step_id.to_string(), kind.to_string());
    h.store
        .patch_checkpoint(run_id, move |cp| {
            cp.steps.insert(
                step_id.clone(),
                crate::store::CheckpointStep {
                    step_id,
                    kind,
                    status,
                    outputs: matches!(status, StepStatus::Succeeded).then(serde_json::Map::new),
                    error: None,
                    started_at: Some(1),
                    finished_at: matches!(status, StepStatus::Succeeded | StepStatus::Skipped)
                        .then_some(1),
                    chat_id: None,
                    interaction_id: None,
                },
            );
        })
        .await
        .unwrap();
}

#[tokio::test]
async fn a_fresh_interpreter_resumes_without_rerunning_succeeded_or_skipped_steps() {
    let h = harness().await;
    let calls = Arc::new(Mutex::new(Vec::<String>::new()));
    let seen = calls.clone();
    let ports = || FakePorts {
        notify: Box::new({
            let seen = seen.clone();
            move |step, _| {
                seen.lock().unwrap().push(step.id.clone());
                completed(empty_outputs())
            }
        }),
        ..FakePorts::default()
    };
    let def = definition(vec![
        notify_step("step-a", vec![text("a")]),
        notify_step("step-skip", vec![text("s")]),
        notify_step("step-b", vec![text("b")]),
    ]);
    let engine1 = h.interpreter(ports());
    let run = engine1
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();

    // Crash after step-a committed and step-skip was marked skipped.
    seed_step(&h, &run.id, "step-a", "notify", StepStatus::Succeeded).await;
    seed_step(&h, &run.id, "step-skip", "notify", StepStatus::Skipped).await;

    let engine2 = h.interpreter(ports());
    engine2.advance(&run.id).await.unwrap();

    assert_eq!(*calls.lock().unwrap(), vec!["step-b"]);
    assert_eq!(
        h.store.get_run(&run.id).await.unwrap().unwrap().status,
        RunStatus::Succeeded
    );
}

fn idempotent_engine(
    h: &super::test_support::Harness,
    ports: FakePorts,
    idempotent: bool,
) -> Interpreter {
    let mut deps = h.deps(ports);
    deps.is_idempotent = Some(Arc::new(move |_step| idempotent));
    Interpreter::new(deps)
}

#[tokio::test]
async fn a_stale_running_run_action_reruns_when_the_action_is_idempotent() {
    let h = harness().await;
    let calls = Arc::new(Mutex::new(0u32));
    let seen = calls.clone();
    let ports = FakePorts {
        run_action: Box::new(move |_, _| {
            *seen.lock().unwrap() += 1;
            completed(empty_outputs())
        }),
        ..FakePorts::default()
    };
    let engine = idempotent_engine(&h, ports, true);
    let def = definition(vec![run_action_step("run-1", "idempotent-op", false)]);
    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    seed_step(&h, &run.id, "run-1", "run_action", StepStatus::Running).await;

    engine.advance(&run.id).await.unwrap();

    assert_eq!(*calls.lock().unwrap(), 1);
    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Succeeded);
    assert_eq!(
        finished.checkpoint.steps["run-1"].status,
        StepStatus::Succeeded
    );
}

#[tokio::test]
async fn a_stale_running_run_action_fails_the_run_loudly_by_default() {
    let h = harness().await;
    let engine = h.interpreter(FakePorts::default());
    let def = definition(vec![run_action_step("run-1", "risky-op", false)]);
    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    seed_step(&h, &run.id, "run-1", "run_action", StepStatus::Running).await;

    engine.advance(&run.id).await.unwrap();

    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Failed);
    assert_eq!(finished.checkpoint.error.as_deref(), Some(RESTART_ERROR));
    assert_eq!(
        finished.checkpoint.steps["run-1"].status,
        StepStatus::Failed
    );
}

#[tokio::test]
async fn keep_going_on_the_stale_step_fails_just_that_step_and_continues() {
    let h = harness().await;
    let ports = FakePorts {
        notify: Box::new(|_, _| completed(empty_outputs())),
        ..FakePorts::default()
    };
    let engine = h.interpreter(ports);
    let def = definition(vec![
        run_action_step("run-1", "risky-op", true),
        notify_step("notify-1", vec![text("done")]),
    ]);
    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    seed_step(&h, &run.id, "run-1", "run_action", StepStatus::Running).await;

    engine.advance(&run.id).await.unwrap();

    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Succeeded);
    assert_eq!(
        finished.checkpoint.steps["run-1"].status,
        StepStatus::Failed
    );
    assert_eq!(
        finished.checkpoint.steps["run-1"].error.as_deref(),
        Some(RESTART_ERROR)
    );
    assert_eq!(
        finished.checkpoint.steps["notify-1"].status,
        StepStatus::Succeeded
    );
}

#[tokio::test]
async fn a_stale_running_ask_agent_always_fails_loudly_even_with_an_idempotent_hook() {
    let h = harness().await;
    // Hook says "everything is idempotent" — ask_agent must never consult it.
    let engine = idempotent_engine(&h, FakePorts::default(), true);
    let def = definition(vec![ask_agent_step("agent-1", false)]);
    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    seed_step(&h, &run.id, "agent-1", "ask_agent", StepStatus::Running).await;

    engine.advance(&run.id).await.unwrap();

    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Failed);
    assert_eq!(finished.checkpoint.error.as_deref(), Some(RESTART_ERROR));
}
