//! Phase 4a — the concurrent branch driver. `walk_frame` used to return on
//! the first `Parked`, so starting N agents at once was impossible: agent 1
//! parks and the walk stops before agent 2 ever starts. These tests pin that
//! N branches now start together, wait-for-all failure, the branch marker's
//! replay safety, and per-entry `wake_at` (Node parity: none — greenfield).

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::json;

use crate::domain::Step;
use crate::store::{RunRecord, RunStatus, StepStatus};

use super::markers::{BRANCH_OUTCOME_KIND, REPEAT_WATERMARK_KIND, is_engine_marker};
use super::test_support::{
    FakePorts, Harness, ask_agent_step, completed, concurrent_repeat_step, cond_is, definition,
    empty_outputs, harness, if_step, manual_with_payload, notify_step, repeat_step, text,
    token_ref, wait_step,
};
use super::{StepOutcome, VerbContext};

fn fanout(concurrency: u32) -> Step {
    concurrent_repeat_step(
        "fanout",
        token_ref("trigger", "items", None),
        concurrency,
        vec![ask_agent_step("agent", false)],
    )
}

/// Flips an already-dispatched leaf entry as an out-of-band settle would —
/// `walk_frame` never re-dispatches a `waiting` step, so a test can't force
/// a settle by swapping the port handler.
async fn settle_leaf(
    h: &Harness,
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

async fn settle(h: &Harness, run_id: &str, pred: impl Fn(&RunRecord) -> bool) -> RunRecord {
    for _ in 0..100 {
        let record = h.store.get_run(run_id).await.unwrap().unwrap();
        if pred(&record) {
            return record;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("run {run_id} never reached the expected state");
}

#[tokio::test]
async fn two_agent_branches_both_start_before_either_settles() {
    let h = harness().await;
    let calls = Arc::new(Mutex::new(Vec::<String>::new()));
    let seen = calls.clone();
    let ports = FakePorts {
        ask_agent: Box::new(move |step, _ctx| {
            seen.lock().unwrap().push(step.id.clone());
            StepOutcome::Wait { wake_at: None }
        }),
        ..FakePorts::default()
    };
    let engine = h.interpreter(ports);
    let def = definition(vec![fanout(2)]);
    let run = engine
        .start_run(
            &h.automation_id,
            def,
            manual_with_payload(json!({"items": ["a", "b"]})),
            None,
        )
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    assert_eq!(*calls.lock().unwrap(), vec!["agent", "agent"]);
    let parked = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(parked.status, RunStatus::Waiting);
    assert_eq!(
        parked.checkpoint.steps["agent#0"].status,
        StepStatus::Waiting
    );
    assert_eq!(
        parked.checkpoint.steps["agent#1"].status,
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
    let def = definition(vec![fanout(2)]);
    let run = engine
        .start_run(
            &h.automation_id,
            def,
            manual_with_payload(json!({"items": ["a", "b"]})),
            None,
        )
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    settle_leaf(&h, &run.id, "agent#0", StepStatus::Succeeded, None).await;
    engine.advance(&run.id).await.unwrap();

    let mid = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(mid.status, RunStatus::Waiting);
    assert_eq!(
        mid.checkpoint.steps["agent#0"].status,
        StepStatus::Succeeded
    );
    assert_eq!(mid.checkpoint.steps["agent#1"].status, StepStatus::Waiting);
}

#[tokio::test]
async fn settling_both_branches_completes_the_run() {
    let h = harness().await;
    let ports = FakePorts {
        ask_agent: Box::new(|_, _| StepOutcome::Wait { wake_at: None }),
        ..FakePorts::default()
    };
    let engine = h.interpreter(ports);
    let def = definition(vec![fanout(2)]);
    let run = engine
        .start_run(
            &h.automation_id,
            def,
            manual_with_payload(json!({"items": ["a", "b"]})),
            None,
        )
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    settle_leaf(&h, &run.id, "agent#0", StepStatus::Succeeded, None).await;
    settle_leaf(&h, &run.id, "agent#1", StepStatus::Succeeded, None).await;
    engine.advance(&run.id).await.unwrap();

    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Succeeded);
}

#[tokio::test]
async fn a_failed_branch_does_not_stop_a_sibling_and_the_run_fails_only_after_both_settle() {
    let h = harness().await;
    let ports = FakePorts {
        ask_agent: Box::new(|_, ctx| {
            if ctx.step_ref == "agent#0" {
                StepOutcome::Failed {
                    error: "branch 0 blew up".to_string(),
                }
            } else {
                StepOutcome::Wait { wake_at: None }
            }
        }),
        ..FakePorts::default()
    };
    let engine = h.interpreter(ports);
    let def = definition(vec![fanout(2)]);
    let run = engine
        .start_run(
            &h.automation_id,
            def,
            manual_with_payload(json!({"items": ["a", "b"]})),
            None,
        )
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    let mid = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(
        mid.status,
        RunStatus::Waiting,
        "branch 1 must still be allowed to finish"
    );
    assert_eq!(mid.checkpoint.steps["agent#0"].status, StepStatus::Failed);
    assert_eq!(mid.checkpoint.steps["agent#1"].status, StepStatus::Waiting);

    settle_leaf(&h, &run.id, "agent#1", StepStatus::Succeeded, None).await;
    engine.advance(&run.id).await.unwrap();

    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Failed);
    assert_eq!(
        finished.checkpoint.error.as_deref(),
        Some("branch 0 blew up")
    );
}

#[tokio::test]
async fn re_advancing_a_settled_branch_does_not_redispatch_it() {
    let h = harness().await;
    let calls = Arc::new(Mutex::new(Vec::<String>::new()));
    let seen = calls.clone();
    let ports = FakePorts {
        ask_agent: Box::new(move |_step, ctx: &VerbContext<'_>| {
            seen.lock().unwrap().push(ctx.step_ref.to_string());
            if ctx.step_ref == "agent#0" {
                StepOutcome::Failed {
                    error: "branch 0 blew up".to_string(),
                }
            } else {
                StepOutcome::Wait { wake_at: None }
            }
        }),
        ..FakePorts::default()
    };
    let engine = h.interpreter(ports);
    let def = definition(vec![fanout(2)]);
    let run = engine
        .start_run(
            &h.automation_id,
            def,
            manual_with_payload(json!({"items": ["a", "b"]})),
            None,
        )
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();
    assert_eq!(*calls.lock().unwrap(), vec!["agent#0", "agent#1"]);

    // The run is still non-terminal (branch 1 parked) — a second advance
    // must not re-walk the already-marked branch 0.
    engine.advance(&run.id).await.unwrap();
    assert_eq!(
        *calls.lock().unwrap(),
        vec!["agent#0", "agent#1"],
        "a settled branch must not be re-dispatched on replay"
    );
    assert_eq!(
        h.store.get_run(&run.id).await.unwrap().unwrap().status,
        RunStatus::Waiting
    );
}

#[tokio::test]
async fn branch_outcome_markers_are_engine_state_excluded_from_the_timeline_predicate() {
    let h = harness().await;
    let ports = FakePorts {
        ask_agent: Box::new(|_, _| StepOutcome::Wait { wake_at: None }),
        ..FakePorts::default()
    };
    let engine = h.interpreter(ports);
    let def = definition(vec![fanout(2)]);
    let run = engine
        .start_run(
            &h.automation_id,
            def,
            manual_with_payload(json!({"items": ["a", "b"]})),
            None,
        )
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();
    settle_leaf(&h, &run.id, "agent#0", StepStatus::Succeeded, None).await;
    settle_leaf(&h, &run.id, "agent#1", StepStatus::Succeeded, None).await;
    engine.advance(&run.id).await.unwrap();

    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Succeeded);
    let branch_markers = finished
        .checkpoint
        .steps
        .values()
        .filter(|e| e.kind == BRANCH_OUTCOME_KIND)
        .count();
    assert_eq!(branch_markers, 2, "one branch marker per branch");
    let watermark_markers = finished
        .checkpoint
        .steps
        .values()
        .filter(|e| e.kind == REPEAT_WATERMARK_KIND)
        .count();
    assert_eq!(
        watermark_markers, 1,
        "one watermark marker for the whole fan-out"
    );
    // The route the server's `project_timeline` filters on: every marker
    // kind is excluded, and no user-facing leaf entry is ever mistaken for
    // one.
    assert!(is_engine_marker(BRANCH_OUTCOME_KIND));
    assert!(is_engine_marker(REPEAT_WATERMARK_KIND));
    assert!(!is_engine_marker(
        &finished.checkpoint.steps["agent#0"].kind
    ));
    assert!(!is_engine_marker(
        &finished.checkpoint.steps["agent#1"].kind
    ));
}

#[tokio::test]
async fn two_parallel_waits_with_different_durations_resolve_independently() {
    let h = harness().await;
    let engine = Arc::new(h.interpreter(FakePorts::default()));
    let def = definition(vec![concurrent_repeat_step(
        "fanout",
        token_ref("trigger", "items", None),
        2,
        vec![if_step(
            "route",
            vec![cond_is("current", "item", "short")],
            vec![wait_step("short_wait", 100)],
            vec![wait_step("long_wait", 300)],
        )],
    )]);
    let run = engine
        .start_run(
            &h.automation_id,
            def,
            manual_with_payload(json!({"items": ["short", "long"]})),
            None,
        )
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    let parked = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(parked.status, RunStatus::Waiting);
    let short_wake = parked.checkpoint.steps["short_wait#0"].wake_at.unwrap();
    let long_wake = parked.checkpoint.steps["long_wait#1"].wake_at.unwrap();
    assert!(short_wake < long_wake);
    assert_eq!(
        parked.checkpoint.wake_at,
        Some(short_wake),
        "the run-level wake_at is the MIN across both parked entries"
    );

    // Sweep exactly the earlier deadline: only the short wait resolves.
    engine.sweep_due(short_wake).await.unwrap();
    let mid = settle(&h, &run.id, |r| {
        r.checkpoint.steps.contains_key("fanout@c#0")
    })
    .await;

    assert_eq!(
        mid.checkpoint.steps["short_wait#0"].status,
        StepStatus::Succeeded
    );
    assert_eq!(
        mid.checkpoint.steps["long_wait#1"].status,
        StepStatus::Waiting,
        "the later deadline must not fire early"
    );
    assert_eq!(mid.status, RunStatus::Waiting);
    assert_eq!(
        mid.checkpoint.wake_at,
        Some(long_wake),
        "recomputed to the one remaining deadline"
    );
}

/// Timestamps aside, `concurrency: None` and `concurrency: Some(1)` must
/// produce the exact same checkpoint — neither ever enters the concurrent
/// driver (`blocks.rs` only routes to it above `Some(1)`), so nothing should
/// distinguish their steps maps, not even a lone `@c`/`@w` marker.
fn normalized_steps(
    checkpoint: &crate::store::AutomationCheckpoint,
) -> std::collections::BTreeMap<String, crate::store::CheckpointStep> {
    let mut steps = checkpoint.steps.clone();
    for entry in steps.values_mut() {
        entry.started_at = None;
        entry.finished_at = None;
        entry.wake_at = None;
    }
    steps
}

#[tokio::test]
async fn concurrency_absent_or_one_is_byte_identical_to_sequential() {
    let mut snapshots = Vec::new();
    for concurrency in [None, Some(1)] {
        let h = harness().await;
        let calls = Arc::new(Mutex::new(Vec::<String>::new()));
        let seen = calls.clone();
        let ports = FakePorts {
            notify: Box::new(move |step, _ctx| {
                seen.lock().unwrap().push(step.id.clone());
                completed(empty_outputs())
            }),
            ..FakePorts::default()
        };
        let engine = h.interpreter(ports);
        let step = match concurrency {
            None => repeat_step(
                "loop",
                token_ref("trigger", "items", None),
                vec![notify_step("greet", vec![text("hi")])],
            ),
            Some(n) => concurrent_repeat_step(
                "loop",
                token_ref("trigger", "items", None),
                n,
                vec![notify_step("greet", vec![text("hi")])],
            ),
        };
        let def = definition(vec![step]);
        let run = engine
            .start_run(
                &h.automation_id,
                def,
                manual_with_payload(json!({"items": ["a", "b", "c"]})),
                None,
            )
            .await
            .unwrap();
        engine.advance(&run.id).await.unwrap();

        assert_eq!(*calls.lock().unwrap(), vec!["greet", "greet", "greet"]);
        let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
        assert_eq!(finished.status, RunStatus::Succeeded);
        snapshots.push(normalized_steps(&finished.checkpoint));
    }
    assert_eq!(
        snapshots[0], snapshots[1],
        "concurrency None vs Some(1) must yield identical steps maps, not merely `@c`-free ones"
    );
}

#[tokio::test]
async fn a_nested_suffix_inside_one_branch_does_not_unlock_a_later_branch_early() {
    // Branch 0 has a nested (sequential) repeat inside it. Walked to its
    // THIRD sub-item, that nested leaf's ref is "agent#0#2" — a naive
    // `ends_with("#2")` check would misread that as branch 2 ("#2") already
    // being outstanding, letting it jump the concurrency:2 budget while
    // branch 1 is still genuinely outstanding.
    let h = harness().await;
    let calls = Arc::new(Mutex::new(Vec::<String>::new()));
    let seen = calls.clone();
    let ports = FakePorts {
        ask_agent: Box::new(move |_step, ctx: &VerbContext<'_>| {
            seen.lock().unwrap().push(ctx.step_ref.to_string());
            StepOutcome::Wait { wake_at: None }
        }),
        ..FakePorts::default()
    };
    let engine = h.interpreter(ports);
    let def = definition(vec![concurrent_repeat_step(
        "fanout",
        token_ref("trigger", "items", None),
        2,
        vec![repeat_step(
            "inner",
            token_ref("trigger", "subitems", None),
            vec![ask_agent_step("agent", false)],
        )],
    )]);
    let run = engine
        .start_run(
            &h.automation_id,
            def,
            manual_with_payload(json!({
                "items": ["a", "b", "c"],
                "subitems": ["p", "q", "r"],
            })),
            None,
        )
        .await
        .unwrap();

    // Budget of 2: branches 0 and 1 both start; branch 2 stays excluded.
    engine.advance(&run.id).await.unwrap();
    assert_eq!(*calls.lock().unwrap(), vec!["agent#0#0", "agent#1#0"]);

    // Walk branch 0's nested repeat to its third sub-item without ever
    // letting branch 1 settle, so the budget stays fully spent throughout.
    settle_leaf(&h, &run.id, "agent#0#0", StepStatus::Succeeded, None).await;
    engine.advance(&run.id).await.unwrap();
    assert_eq!(
        *calls.lock().unwrap(),
        vec!["agent#0#0", "agent#1#0", "agent#0#1"]
    );

    settle_leaf(&h, &run.id, "agent#0#1", StepStatus::Succeeded, None).await;
    engine.advance(&run.id).await.unwrap();
    assert_eq!(
        *calls.lock().unwrap(),
        vec!["agent#0#0", "agent#1#0", "agent#0#1", "agent#0#2"]
    );

    // Re-advance without settling anything: branch 1 is still outstanding,
    // so the concurrency:2 budget is spent — branch 2 must not start just
    // because branch 0's nested ref happens to end in "#2".
    engine.advance(&run.id).await.unwrap();
    assert_eq!(
        *calls.lock().unwrap(),
        vec!["agent#0#0", "agent#1#0", "agent#0#1", "agent#0#2"],
        "branch 2 must stay excluded while the concurrency:2 budget is spent"
    );
    assert_eq!(
        h.store.get_run(&run.id).await.unwrap().unwrap().status,
        RunStatus::Waiting
    );
}
