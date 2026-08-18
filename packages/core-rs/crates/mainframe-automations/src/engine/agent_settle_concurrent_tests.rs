//! MUST-FIX 3 — an agent failure that arrives out-of-band (settle, not
//! `start()`) inside a concurrent branch. Before this fix, `fail_waiting_step`
//! never told the branch driver at all: with `keepGoing: false` it finalized
//! the run immediately while a sibling chat kept running unattended, and the
//! failed leaf's own branch marker was never written, so a later replay would
//! have skipped it and laundered the branch into `Succeeded`. `keepGoing`
//! means the same thing here as everywhere else — don't fail the run over
//! this step — so `keepGoing: true` deliberately skips the marker write and
//! lets the driver's own replay walk past the failed leaf, settling the
//! branch Done exactly like a sequential repeat's iteration would. All of
//! this is covered here via the REAL settle path (`agent_rig`), not a
//! synthetic checkpoint edit — `blocks_concurrent_tests.rs`'s equivalent
//! coverage only exercises the synchronous `start()`-failure path a real
//! agent never takes.

use std::sync::{Arc, Mutex};

use serde_json::json;

use crate::ports::AgentOutcome;
use crate::store::{RunStatus, StepStatus};

use super::agent_test_support::{agent_rig, wait_for_run};
use super::test_support::{
    FakePorts, ask_agent_step, completed, concurrent_repeat_step, definition, empty_outputs,
    manual_with_payload, notify_step, repeat_step, text, token_ref,
};

fn fanout(keep_going: bool) -> crate::domain::Step {
    concurrent_repeat_step(
        "fanout",
        token_ref("trigger", "items", None),
        2,
        vec![ask_agent_step("agent", keep_going)],
    )
}

fn fanout_with_deadline() -> crate::domain::Step {
    let step = match ask_agent_step("agent", false) {
        crate::domain::Step::AskAgent(mut s) => {
            s.timeout_minutes = Some(1);
            crate::domain::Step::AskAgent(s)
        }
        _ => unreachable!(),
    };
    concurrent_repeat_step("fanout", token_ref("trigger", "items", None), 2, vec![step])
}

#[tokio::test]
async fn keep_going_false_out_of_band_failure_waits_for_the_sibling_before_finalizing() {
    let rig = agent_rig(FakePorts::default()).await;
    let def = definition(vec![fanout(false)]);
    let run = rig
        .engine
        .start_run(
            &rig.h.automation_id,
            def,
            manual_with_payload(json!({"items": ["a", "b"]})),
            None,
        )
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();

    rig.port.complete("chat-1", Ok(AgentOutcome::Errored));

    let mid = wait_for_run(&rig.h.store, &run.id, |r| {
        r.checkpoint.steps["agent#0"].status == StepStatus::Failed
    })
    .await;
    assert_eq!(
        mid.status,
        RunStatus::Waiting,
        "the sibling branch is still parked — the run must not finalize yet"
    );
    assert_eq!(
        mid.checkpoint.steps["fanout@c#0"].status,
        StepStatus::Failed,
        "the branch's own marker must be written directly, or a replay would \
         later launder it into Succeeded"
    );
    assert_eq!(mid.checkpoint.steps["agent#1"].status, StepStatus::Waiting);

    rig.port.complete(
        "chat-2",
        Ok(AgentOutcome::Completed {
            final_text: "done".to_string(),
        }),
    );

    let finished = wait_for_run(&rig.h.store, &run.id, |r| r.status == RunStatus::Failed).await;
    assert_eq!(
        finished.checkpoint.error.as_deref(),
        Some("agent chat error")
    );
    assert_eq!(
        finished.checkpoint.steps["fanout@c#1"].status,
        StepStatus::Succeeded,
        "the sibling branch that genuinely succeeded must not be dragged down"
    );
}

#[tokio::test]
async fn keep_going_true_out_of_band_failure_lets_the_branch_and_run_succeed() {
    // keepGoing means the same thing everywhere: don't fail the run over this
    // step. A concurrent branch absorbs the failure exactly like a
    // sequential repeat's iteration does — no marker is written, so the
    // driver's replay walks past the failed leaf and settles the branch Done.
    let rig = agent_rig(FakePorts::default()).await;
    let def = definition(vec![fanout(true)]);
    let run = rig
        .engine
        .start_run(
            &rig.h.automation_id,
            def,
            manual_with_payload(json!({"items": ["a", "b"]})),
            None,
        )
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();

    rig.port.complete("chat-1", Ok(AgentOutcome::Errored));
    rig.port.complete(
        "chat-2",
        Ok(AgentOutcome::Completed {
            final_text: "done".to_string(),
        }),
    );

    let finished = wait_for_run(&rig.h.store, &run.id, |r| r.status == RunStatus::Succeeded).await;
    assert_eq!(
        finished.checkpoint.steps["agent#0"].status,
        StepStatus::Failed,
        "the leaf itself still records its own failure"
    );
    assert_eq!(
        finished.checkpoint.steps["fanout@c#0"].status,
        StepStatus::Succeeded,
        "keepGoing absorbs the leaf failure — the branch settles Done, matching \
         sequential repeat parity, and adding concurrency must not change that"
    );
    assert_eq!(
        finished.checkpoint.steps["fanout@c#1"].status,
        StepStatus::Succeeded
    );
}

#[tokio::test]
async fn keep_going_true_out_of_band_failure_still_runs_a_later_step_in_the_branch() {
    // A branch is not "done" the moment its failed leaf settles — steps after
    // it must still run, or a keepGoing failure silently skips the rest of
    // the branch instead of just not failing the run.
    let notify_calls = Arc::new(Mutex::new(Vec::<String>::new()));
    let notified = notify_calls.clone();
    let rig = agent_rig(FakePorts {
        notify: Box::new(move |step, _ctx| {
            notified.lock().unwrap().push(step.id.clone());
            completed(empty_outputs())
        }),
        ..FakePorts::default()
    })
    .await;
    let def = definition(vec![concurrent_repeat_step(
        "fanout",
        token_ref("trigger", "items", None),
        2,
        vec![
            ask_agent_step("agent", true),
            notify_step("after", vec![text("ping")]),
        ],
    )]);
    let run = rig
        .engine
        .start_run(
            &rig.h.automation_id,
            def,
            manual_with_payload(json!({"items": ["a", "b"]})),
            None,
        )
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();

    rig.port.complete("chat-1", Ok(AgentOutcome::Errored));

    let mid = wait_for_run(&rig.h.store, &run.id, |r| {
        r.checkpoint
            .steps
            .get("after#0")
            .is_some_and(|e| e.status == StepStatus::Succeeded)
    })
    .await;
    assert_eq!(mid.checkpoint.steps["agent#0"].status, StepStatus::Failed);

    rig.port.complete(
        "chat-2",
        Ok(AgentOutcome::Completed {
            final_text: "done".to_string(),
        }),
    );

    let finished = wait_for_run(&rig.h.store, &run.id, |r| r.status == RunStatus::Succeeded).await;
    assert_eq!(
        finished.checkpoint.steps["after#1"].status,
        StepStatus::Succeeded
    );
}

#[tokio::test]
async fn a_concurrent_repeat_nested_inside_a_sequential_repeat_fails_on_the_full_chain_marker() {
    // The marker key must carry every ancestor iteration, not just the
    // branch's own segment, or the driver's replay writes to a key no branch
    // owns and launders the real branch into Succeeded.
    let rig = agent_rig(FakePorts::default()).await;
    let def = definition(vec![repeat_step(
        "outer",
        token_ref("trigger", "outer_items", None),
        vec![concurrent_repeat_step(
            "fanout",
            token_ref("trigger", "items", None),
            2,
            vec![ask_agent_step("agent", false)],
        )],
    )]);
    let run = rig
        .engine
        .start_run(
            &rig.h.automation_id,
            def,
            manual_with_payload(json!({"outer_items": ["x"], "items": ["a", "b"]})),
            None,
        )
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();

    rig.port.complete("chat-1", Ok(AgentOutcome::Errored));

    // Waits for chat-1's settle to fully land (branch marker written, sibling
    // still parked) before firing chat-2 — otherwise the two settles race and
    // whichever's `advance()` runs first can finalize the run before the
    // other branch's own marker is written.
    let mid = wait_for_run(&rig.h.store, &run.id, |r| {
        r.checkpoint
            .steps
            .get("fanout@c#0#0")
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
        finished.checkpoint.steps["fanout@c#0#1"].status,
        StepStatus::Succeeded,
        "the sibling branch that genuinely succeeded must not be dragged down"
    );
}

#[tokio::test]
async fn keep_going_false_out_of_band_interrupt_marks_the_branch_failed() {
    // Confirms the AgentOutcome -> Verdict mapping: `Interrupted` funnels
    // through the same `Verdict::Fail` arm as `Errored`, so it needs the same
    // branch-marker coverage as the rest of this file's Errored-based tests.
    let rig = agent_rig(FakePorts::default()).await;
    let def = definition(vec![fanout(false)]);
    let run = rig
        .engine
        .start_run(
            &rig.h.automation_id,
            def,
            manual_with_payload(json!({"items": ["a", "b"]})),
            None,
        )
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();

    rig.port.complete("chat-1", Ok(AgentOutcome::Interrupted));
    rig.port.complete(
        "chat-2",
        Ok(AgentOutcome::Completed {
            final_text: "done".to_string(),
        }),
    );

    let finished = wait_for_run(&rig.h.store, &run.id, |r| r.status == RunStatus::Failed).await;
    assert_eq!(
        finished.checkpoint.error.as_deref(),
        Some("agent chat interrupted")
    );
    assert_eq!(
        finished.checkpoint.steps["fanout@c#0"].status,
        StepStatus::Failed
    );
}

/// Nothing else exercises `timeoutMinutes` together with `concurrency` —
/// the combination per-entry `wake_at` (Phase 4a) exists for. Both branches
/// share one `timeoutMinutes`, so both come due in the same sweep; the
/// assertion that matters is that EACH gets its OWN branch marker (not one
/// shared verdict) via the SAME out-of-band path as the settle tests above.
#[tokio::test]
async fn a_deadline_inside_a_concurrent_repeat_fails_each_branch_on_its_own_marker() {
    let rig = agent_rig(FakePorts::default()).await;
    let def = definition(vec![fanout_with_deadline()]);
    let run = rig
        .engine
        .start_run(
            &rig.h.automation_id,
            def,
            manual_with_payload(json!({"items": ["a", "b"]})),
            None,
        )
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();

    let parked = rig.h.store.get_run(&run.id).await.unwrap().unwrap();
    let wake_at = parked.checkpoint.wake_at.unwrap();
    // The run-level `wake_at` is the MIN across both branches' own entries
    // (checkpoint::recompute_wake_at); each branch computes its own via a
    // fresh `epoch_ms_now()` after its own park write lands, and the two
    // branches park sequentially (one real disk write apart), so their
    // timestamps can straddle a millisecond boundary. `+1` reproducibly
    // caught only the earlier branch's deadline and left the run wedged in
    // `Waiting` forever — a real periodic sweep (30 s later) never has this
    // problem, so a generous margin here is a faithful stand-in.
    rig.engine.sweep_due(wake_at + 5_000).await.unwrap();

    let finished = wait_for_run(&rig.h.store, &run.id, |r| r.status == RunStatus::Failed).await;
    assert_eq!(
        finished.checkpoint.error.as_deref(),
        Some("agent step deadline exceeded")
    );
    for branch_ref in ["fanout@c#0", "fanout@c#1"] {
        assert_eq!(
            finished.checkpoint.steps[branch_ref].status,
            StepStatus::Failed,
            "{branch_ref} must carry its own Failed marker, not read Succeeded off a replay"
        );
    }
}
