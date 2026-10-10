//! `Interpreter::settle_out_of_band`: the first outcome written for a parked
//! step wins, and a late settle (a second completion, a completion after the
//! deadline, a write against a finished run) changes nothing and streams
//! nothing. Every interleaving here is driven step by step, with no timers.

use serde_json::{Map, json};

use crate::domain::Step;
use crate::store::{RunStatus, StepKind, StepStatus};

use super::OutOfBandOutcome;
use super::agent_test_support::{AgentRig, agent_rig};
use super::out_of_band::patch_if_changed;
use super::test_support::{FakePorts, ask_agent_step, definition, manual, parallel_step};

fn done() -> OutOfBandOutcome {
    OutOfBandOutcome::Succeeded(Map::from_iter([("result".to_string(), json!("done"))]))
}

fn failed(error: &str) -> OutOfBandOutcome {
    OutOfBandOutcome::Failed(error.to_string())
}

fn with_deadline(step: Step) -> Step {
    match step {
        Step::AskAgent(mut s) => {
            s.timeout_minutes = Some(1);
            Step::AskAgent(s)
        }
        other => other,
    }
}

/// Starts and advances a run until its agent steps park.
async fn parked_run(rig: &AgentRig, steps: Vec<Step>) -> String {
    let run = rig
        .engine
        .start_run(&rig.h.automation_id, definition(steps), manual(), None)
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();
    run.id
}

/// The checkpoint ref the walk recorded for `step_id`.
async fn ref_of(rig: &AgentRig, run_id: &str, step_id: &str) -> String {
    let run = rig.h.store.get_run(run_id).await.unwrap().unwrap();
    run.checkpoint
        .steps
        .iter()
        .find(|(_, entry)| entry.step_id == step_id)
        .map(|(step_ref, _)| step_ref.clone())
        .unwrap()
}

fn two_agent_fan(a: Step) -> Vec<Step> {
    vec![parallel_step(
        "fan",
        vec![vec![a], vec![ask_agent_step("b", false)]],
    )]
}

#[tokio::test]
async fn a_late_success_cannot_resurrect_a_failed_step() {
    let rig = agent_rig(FakePorts::default()).await;
    let run_id = parked_run(&rig, vec![ask_agent_step("agent", false)]).await;

    rig.engine
        .settle_out_of_band(&run_id, "agent", failed("first failure"))
        .await
        .unwrap();
    let updates = rig.h.sink.run_updates().len();
    rig.engine
        .settle_out_of_band(&run_id, "agent", done())
        .await
        .unwrap();

    let run = rig.h.store.get_run(&run_id).await.unwrap().unwrap();
    assert_eq!(run.status, RunStatus::Failed);
    let entry = &run.checkpoint.steps["agent"];
    assert_eq!(entry.status, StepStatus::Failed);
    assert_eq!(entry.error.as_deref(), Some("first failure"));
    assert_eq!(entry.outputs, None);
    assert_eq!(rig.h.sink.run_updates().len(), updates);
}

/// A sibling branch keeps the run alive, so only the entry guard (not the
/// terminal-run guard) stands between the late failure and the checkpoint.
#[tokio::test]
async fn a_late_settle_of_a_settled_step_is_a_no_op() {
    let rig = agent_rig(FakePorts::default()).await;
    let run_id = parked_run(&rig, two_agent_fan(ask_agent_step("a", false))).await;
    let a_ref = ref_of(&rig, &run_id, "a").await;

    rig.engine
        .settle_out_of_band(&run_id, &a_ref, done())
        .await
        .unwrap();
    let updates = rig.h.sink.run_updates().len();
    rig.engine
        .settle_out_of_band(&run_id, &a_ref, failed("late failure"))
        .await
        .unwrap();

    let run = rig.h.store.get_run(&run_id).await.unwrap().unwrap();
    assert_eq!(run.status, RunStatus::Waiting);
    let a = &run.checkpoint.steps[&a_ref];
    assert_eq!(a.status, StepStatus::Succeeded);
    assert_eq!(a.error, None);
    assert_eq!(a.outputs.as_ref().unwrap()["result"], "done");
    assert_eq!(rig.h.sink.run_updates().len(), updates);
}

/// The deadline sweep and the agent completion share one settle path: once
/// the deadline failed the step, the chat's eventual answer is dropped.
#[tokio::test]
async fn an_agent_completion_after_the_deadline_is_dropped() {
    let rig = agent_rig(FakePorts::default()).await;
    let run_id = parked_run(
        &rig,
        two_agent_fan(with_deadline(ask_agent_step("a", false))),
    )
    .await;
    let a_ref = ref_of(&rig, &run_id, "a").await;
    let parked = rig.h.store.get_run(&run_id).await.unwrap().unwrap();
    let deadline = parked.checkpoint.steps[&a_ref].wake_at.unwrap();

    rig.engine.sweep_due(deadline + 1).await.unwrap();
    let updates = rig.h.sink.run_updates().len();
    rig.engine
        .settle_out_of_band(&run_id, &a_ref, done())
        .await
        .unwrap();

    let run = rig.h.store.get_run(&run_id).await.unwrap().unwrap();
    assert_eq!(run.status, RunStatus::Waiting);
    let a = &run.checkpoint.steps[&a_ref];
    assert_eq!(a.status, StepStatus::Failed);
    assert_eq!(a.error.as_deref(), Some("agent step deadline exceeded"));
    assert_eq!(a.outputs, None);
    let b_ref = ref_of(&rig, &run_id, "b").await;
    assert_eq!(run.checkpoint.steps[&b_ref].status, StepStatus::Waiting);
    assert_eq!(rig.h.sink.run_updates().len(), updates);
}

/// A success and a failure for the same parked step, settled concurrently.
/// The settle path does no pre-read: both reach the checkpoint transaction,
/// and the in-transaction "still waiting" check alone admits the first and
/// rejects the second. Which one the scheduler lets in first varies, so the
/// test pins the exact final state for each winner and fails on any blend
/// (both written, neither written, or a mix of their fields). Each ordering
/// of the two settles in `join!` gets its own run. The sibling
/// keeps the run `waiting` either way, so the terminal-run guard never
/// stands in for the entry check.
#[tokio::test]
async fn concurrent_success_and_failure_settle_exactly_one_outcome() {
    let rig = agent_rig(FakePorts::default()).await;
    let success_first = parked_run(&rig, two_agent_fan(ask_agent_step("a", false))).await;
    let failure_first = parked_run(&rig, two_agent_fan(ask_agent_step("a", false))).await;
    let success_first_ref = ref_of(&rig, &success_first, "a").await;
    let failure_first_ref = ref_of(&rig, &failure_first, "a").await;

    let (s1, f1) = tokio::join!(
        rig.engine
            .settle_out_of_band(&success_first, &success_first_ref, done()),
        rig.engine
            .settle_out_of_band(&success_first, &success_first_ref, failed("boom")),
    );
    let (f2, s2) = tokio::join!(
        rig.engine
            .settle_out_of_band(&failure_first, &failure_first_ref, failed("boom")),
        rig.engine
            .settle_out_of_band(&failure_first, &failure_first_ref, done()),
    );
    for result in [s1, f1, f2, s2] {
        result.unwrap();
    }

    for (run_id, a_ref) in [
        (&success_first, &success_first_ref),
        (&failure_first, &failure_first_ref),
    ] {
        let run = rig.h.store.get_run(run_id).await.unwrap().unwrap();
        assert_eq!(run.status, RunStatus::Waiting);
        let b_ref = ref_of(&rig, run_id, "b").await;
        assert_eq!(run.checkpoint.steps[&b_ref].status, StepStatus::Waiting);
        let a = &run.checkpoint.steps[a_ref];
        // The failure, when it lands, also fails a's branch marker; a
        // success that overwrote it afterwards would leave that marker behind.
        let failed_branch_markers: Vec<Option<&str>> = run
            .checkpoint
            .steps
            .values()
            .filter(|entry| entry.kind == StepKind::BranchOutcome)
            .filter(|entry| entry.status == StepStatus::Failed)
            .map(|entry| entry.error.as_deref())
            .collect();
        match a.status {
            StepStatus::Succeeded => {
                assert_eq!(
                    a.outputs,
                    Some(Map::from_iter([("result".to_string(), json!("done"))]))
                );
                assert_eq!(a.error, None);
                assert_eq!(failed_branch_markers, Vec::<Option<&str>>::new());
            }
            StepStatus::Failed => {
                assert_eq!(a.error.as_deref(), Some("boom"));
                assert_eq!(a.outputs, None);
                assert_eq!(failed_branch_markers, vec![Some("boom")]);
            }
            other => panic!("neither settle landed on {a_ref}: {other:?}"),
        }
        assert_eq!(a.wake_at, None);
    }
}

#[tokio::test]
async fn a_transition_that_changes_nothing_reports_no_update() {
    let rig = agent_rig(FakePorts::default()).await;
    let run_id = parked_run(&rig, vec![ask_agent_step("agent", false)]).await;

    // The transition mutates its copy but reports no change: nothing of it
    // may reach the row.
    let unchanged = patch_if_changed(&rig.h.store, &run_id, |cp| {
        cp.steps.clear();
        false
    })
    .await
    .unwrap();
    let stored = rig.h.store.get_run(&run_id).await.unwrap().unwrap();
    assert_eq!(stored.checkpoint.steps["agent"].status, StepStatus::Waiting);
    let changed = patch_if_changed(&rig.h.store, &run_id, |cp| {
        cp.succeed_waiting_step("agent", None)
    })
    .await
    .unwrap();

    assert!(unchanged.is_none());
    let record = changed.unwrap();
    assert_eq!(
        record.checkpoint.steps["agent"].status,
        StepStatus::Succeeded
    );
}

/// Cancel finalizing the run first surfaces as "no update", not an error, so
/// the losing settle neither emits nor fails its caller.
#[tokio::test]
async fn a_write_against_a_finished_run_reports_no_update() {
    let rig = agent_rig(FakePorts::default()).await;
    let run_id = parked_run(&rig, vec![ask_agent_step("agent", false)]).await;
    rig.engine
        .settle_out_of_band(&run_id, "agent", failed("boom"))
        .await
        .unwrap();

    let late = patch_if_changed(&rig.h.store, &run_id, |cp| {
        cp.steps.clear();
        true
    })
    .await
    .unwrap();

    assert!(late.is_none());
    let run = rig.h.store.get_run(&run_id).await.unwrap().unwrap();
    assert_eq!(run.status, RunStatus::Failed);
    assert!(run.checkpoint.steps.contains_key("agent"));
}
