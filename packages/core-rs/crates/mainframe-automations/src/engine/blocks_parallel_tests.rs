//! Phase 4b — the `parallel` block. Its branches are authored directly
//! (heterogeneous bodies), unlike `blocks_concurrent_repeat`'s identical body
//! run once per item, but it drives through the SAME `run_branches` — so
//! these tests pin that the two never diverge: every branch starts before
//! either settles, one settling leaves the others parked, and wait-for-all
//! failure reports the lowest-indexed error regardless of settle order.

use std::sync::{Arc, Mutex};

use serde_json::json;

use crate::ports::{AgentOutcome, AgentPortError};
use crate::store::{RunStatus, StepStatus};

use super::StepOutcome;
use super::agent_test_support::{agent_rig, wait_for_run};
use super::test_support::{
    FakePorts, ask_agent_step, completed, definition, empty_outputs, harness, manual, notify_step,
    parallel_step, repeat_step, text, token_ref,
};

fn split(branches: Vec<Vec<crate::domain::Step>>) -> crate::domain::Step {
    parallel_step("split", branches)
}

/// Flips an already-dispatched leaf entry as an out-of-band settle would —
/// mirrors `blocks_concurrent_tests.rs`'s helper of the same name.
async fn settle_leaf(
    h: &super::test_support::Harness,
    run_id: &str,
    step_ref: &str,
    status: StepStatus,
    error: Option<String>,
) {
    let step_ref = step_ref.to_string();
    h.store
        .patch_checkpoint(run_id, move |cp| {
            if let Some(entry) = cp.steps.get_mut(&step_ref) {
                entry.status = status;
                entry.error = error;
                entry.outputs = matches!(status, StepStatus::Succeeded).then(empty_outputs);
                entry.finished_at = Some(1);
            }
        })
        .await
        .unwrap();
}

#[tokio::test]
async fn every_branch_starts_before_either_settles_even_with_different_bodies() {
    let h = harness().await;
    let calls = Arc::new(Mutex::new(Vec::<String>::new()));
    let agent_seen = calls.clone();
    let notify_seen = calls.clone();
    let ports = FakePorts {
        ask_agent: Box::new(move |step, _ctx| {
            agent_seen.lock().unwrap().push(step.id.clone());
            StepOutcome::Wait { wake_at: None }
        }),
        notify: Box::new(move |step, _ctx| {
            notify_seen.lock().unwrap().push(step.id.clone());
            completed(empty_outputs())
        }),
        ..FakePorts::default()
    };
    let engine = h.interpreter(ports);
    let def = definition(vec![split(vec![
        vec![ask_agent_step("agentA", false)],
        vec![
            notify_step("ping", vec![text("hi")]),
            ask_agent_step("agentB", false),
        ],
    ])]);
    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    assert_eq!(*calls.lock().unwrap(), vec!["agentA", "ping", "agentB"]);
    let parked = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(parked.status, RunStatus::Waiting);
    assert_eq!(
        parked.checkpoint.steps["agentA#0"].status,
        StepStatus::Waiting
    );
    assert_eq!(
        parked.checkpoint.steps["ping#1"].status,
        StepStatus::Succeeded
    );
    assert_eq!(
        parked.checkpoint.steps["agentB#1"].status,
        StepStatus::Waiting
    );
}

#[tokio::test]
async fn settling_one_branch_leaves_the_other_parked_and_the_run_waiting() {
    let h = harness().await;
    let ports = FakePorts {
        ask_agent: Box::new(|_, _| StepOutcome::Wait { wake_at: None }),
        ..FakePorts::default()
    };
    let engine = h.interpreter(ports);
    let def = definition(vec![split(vec![
        vec![ask_agent_step("agentA", false)],
        vec![ask_agent_step("agentB", false)],
    ])]);
    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    settle_leaf(&h, &run.id, "agentA#0", StepStatus::Succeeded, None).await;
    engine.advance(&run.id).await.unwrap();

    let mid = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(mid.status, RunStatus::Waiting);
    assert_eq!(
        mid.checkpoint.steps["agentA#0"].status,
        StepStatus::Succeeded
    );
    assert_eq!(mid.checkpoint.steps["agentB#1"].status, StepStatus::Waiting);
}

#[tokio::test]
async fn wait_for_all_failure_reports_the_lowest_indexed_branch_regardless_of_settle_order() {
    // Real out-of-band settles (`agent_rig`), not a synthetic checkpoint
    // edit: `walk_frame` treats an already-`failed` step as settled and
    // continues past it, so a raw leaf-status flip skips the branch driver's
    // own marker write entirely — only the settle path's `fail_enclosing_branch`
    // keeps a replay from laundering the branch into `Succeeded`.
    let rig = agent_rig(FakePorts::default()).await;
    let def = definition(vec![split(vec![
        vec![ask_agent_step("agentA", false)],
        vec![ask_agent_step("agentB", false)],
    ])]);
    let run = rig
        .engine
        .start_run(&rig.h.automation_id, def, manual(), None)
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();

    // chat-1 = agentA (branch 0, dispatched first), chat-2 = agentB (branch
    // 1). Branch 1 settles FAILED first; branch 0 settles failed second —
    // the reported error must still be branch 0's, by index, not whichever
    // settled first.
    rig.port.complete(
        "chat-2",
        Err(AgentPortError("branch one blew up".to_string())),
    );
    let mid = wait_for_run(&rig.h.store, &run.id, |r| {
        r.checkpoint
            .steps
            .get("agentB#1")
            .is_some_and(|e| e.status == StepStatus::Failed)
    })
    .await;
    assert_eq!(
        mid.status,
        RunStatus::Waiting,
        "branch 0 is still outstanding"
    );

    rig.port.complete(
        "chat-1",
        Err(AgentPortError("branch zero blew up".to_string())),
    );
    let finished = wait_for_run(&rig.h.store, &run.id, |r| r.status == RunStatus::Failed).await;
    assert_eq!(
        finished.checkpoint.error.as_deref(),
        Some("branch zero blew up"),
        "the lowest-indexed failure wins, not whichever settled first"
    );
}

#[tokio::test]
async fn a_parallel_below_the_top_level_failing_a_leaf_out_of_band_resolves_the_right_marker() {
    // Mirrors blocks_concurrent's equivalent test for a concurrent Repeat —
    // the marker key must carry the outer repeat's own iteration segment, or
    // the driver's replay writes to a key no branch owns and launders the
    // real branch into Succeeded.
    let rig = agent_rig(FakePorts::default()).await;
    let def = definition(vec![repeat_step(
        "outer",
        token_ref("trigger", "outer_items", None),
        vec![split(vec![
            vec![ask_agent_step("agent", false)],
            vec![ask_agent_step("agent2", false)],
        ])],
    )]);
    let run = rig
        .engine
        .start_run(
            &rig.h.automation_id,
            def,
            super::test_support::manual_with_payload(json!({"outer_items": ["x"]})),
            None,
        )
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();

    rig.port.complete("chat-1", Ok(AgentOutcome::Errored));

    let mid = wait_for_run(&rig.h.store, &run.id, |r| {
        r.checkpoint
            .steps
            .get("split@c#0#0")
            .is_some_and(|e| e.status == StepStatus::Failed)
    })
    .await;
    assert_eq!(
        mid.status,
        RunStatus::Waiting,
        "the sibling branch is still parked"
    );

    rig.port.complete(
        "chat-2",
        Ok(AgentOutcome::Completed {
            final_text: "done".to_string(),
        }),
    );

    let finished = wait_for_run(&rig.h.store, &run.id, |r| r.status == RunStatus::Failed).await;
    assert_eq!(
        finished.checkpoint.steps["split@c#0#1"].status,
        StepStatus::Succeeded,
        "the sibling branch that genuinely succeeded must not be dragged down"
    );
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md Phase 4b), not a TS port
// confidence: high
// todos: 0
// notes: mirrors blocks_concurrent_tests.rs + agent_settle_concurrent_tests.rs
//        1:1 — the parallel driver IS the concurrent-repeat driver, so any
//        divergence here would be a real behavioral bug, not a style choice.
