//! `Interpreter::settle_out_of_band` under competing settles: the first
//! outcome written wins and a loser neither rewrites nor streams anything.

use serde_json::json;

use crate::store::{RunStatus, StepStatus};

use super::OutOfBandOutcome;
use super::agent_test_support::agent_rig;
use super::test_support::{FakePorts, ask_agent_step, definition, parallel_step};

#[tokio::test]
async fn simultaneous_out_of_band_settles_keep_the_first_step_outcome() {
    let rig = agent_rig(FakePorts::default()).await;
    let run = rig
        .engine
        .start_run(
            &rig.h.automation_id,
            definition(vec![ask_agent_step("agent", false)]),
            crate::store::RunTriggerContext::manual(),
            None,
        )
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();

    let success = rig.engine.settle_out_of_band(
        &run.id,
        "agent",
        OutOfBandOutcome::Succeeded(serde_json::Map::from_iter([(
            "result".to_string(),
            json!("done"),
        )])),
    );
    let failure = rig.engine.settle_out_of_band(
        &run.id,
        "agent",
        OutOfBandOutcome::Failed("late failure".to_string()),
    );
    let (succeeded, failed) = tokio::join!(success, failure);
    succeeded.unwrap();
    failed.unwrap();

    let finished = rig.h.store.get_run(&run.id).await.unwrap().unwrap();
    match finished.checkpoint.steps["agent"].status {
        StepStatus::Succeeded => {
            assert_eq!(finished.status, RunStatus::Succeeded);
            assert_eq!(
                finished.checkpoint.steps["agent"].outputs.as_ref().unwrap()["result"],
                "done"
            );
        }
        StepStatus::Failed => {
            assert_eq!(finished.status, RunStatus::Failed);
            assert_eq!(
                finished.checkpoint.steps["agent"].error.as_deref(),
                Some("late failure")
            );
        }
        other => panic!("expected a terminal step, got {other:?}"),
    }
}

/// Deterministic half of the race above: while a sibling branch keeps the run
/// alive, a second settle of an already-settled step changes nothing and
/// streams nothing.
#[tokio::test]
async fn a_late_settle_of_a_settled_step_is_a_no_op() {
    let rig = agent_rig(FakePorts::default()).await;
    let run = rig
        .engine
        .start_run(
            &rig.h.automation_id,
            definition(vec![parallel_step(
                "fan",
                vec![
                    vec![ask_agent_step("a", false)],
                    vec![ask_agent_step("b", false)],
                ],
            )]),
            crate::store::RunTriggerContext::manual(),
            None,
        )
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();
    let parked = rig.h.store.get_run(&run.id).await.unwrap().unwrap();
    let a_ref = parked
        .checkpoint
        .steps
        .iter()
        .find(|(_, entry)| entry.step_id == "a")
        .map(|(step_ref, _)| step_ref.clone())
        .unwrap();

    let outputs = serde_json::Map::from_iter([("result".to_string(), json!("done"))]);
    rig.engine
        .settle_out_of_band(&run.id, &a_ref, OutOfBandOutcome::Succeeded(outputs))
        .await
        .unwrap();
    let updates_after_first = rig.h.sink.run_updates().len();
    rig.engine
        .settle_out_of_band(
            &run.id,
            &a_ref,
            OutOfBandOutcome::Failed("late failure".to_string()),
        )
        .await
        .unwrap();

    let after = rig.h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(after.status, RunStatus::Waiting);
    let a = &after.checkpoint.steps[&a_ref];
    assert_eq!(a.status, StepStatus::Succeeded);
    assert_eq!(a.error, None);
    assert_eq!(a.outputs.as_ref().unwrap()["result"], "done");
    assert_eq!(rig.h.sink.run_updates().len(), updates_after_first);
}
