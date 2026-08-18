//! `wait` step (Part 3 Phase 1): parks the run on a `wake_at` that the
//! existing deadline sweep resumes. The sweep is the only clock — there is no
//! timer — so these tests drive `sweep_due` with an explicit `now`.

use std::sync::Arc;

use serde_json::json;

use crate::store::{RunRecord, RunStatus, StepStatus, epoch_ms_now};

use super::test_support::{
    FakePorts, Harness, completed, definition, harness, manual, notify_step, text, wait_step,
};

fn outputs(pairs: &[(&str, serde_json::Value)]) -> serde_json::Map<String, serde_json::Value> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.clone()))
        .collect()
}

/// Poll until the run reaches `status`. The wait resume spawns its advance, so
/// the sweep returning is not the same as the run having moved.
async fn settle(h: &Harness, run_id: &str, status: RunStatus) -> RunRecord {
    for _ in 0..100 {
        let record = h.store.get_run(run_id).await.unwrap().unwrap();
        if record.status == status {
            return record;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    panic!("run {run_id} never reached {status:?}");
}

#[tokio::test]
async fn parks_the_run_and_arms_a_wake_at_the_full_delay_out() {
    let h = harness().await;
    let engine = Arc::new(h.interpreter(FakePorts::default()));
    let def = definition(vec![wait_step("pause", 300)]);

    let before = epoch_ms_now();
    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    let parked = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(parked.status, RunStatus::Waiting);
    assert_eq!(parked.checkpoint.steps["pause"].status, StepStatus::Waiting);
    let wake_at = parked
        .checkpoint
        .wake_at
        .expect("a wait step arms the checkpoint's wake_at");
    assert!(
        wake_at >= before + 300_000,
        "wake_at {wake_at} must be at least the full 300s past {before}"
    );
}

#[tokio::test]
async fn stays_parked_while_the_wake_at_is_still_in_the_future() {
    let h = harness().await;
    let engine = Arc::new(h.interpreter(FakePorts::default()));
    let def = definition(vec![
        wait_step("pause", 300),
        notify_step("after", vec![text("x")]),
    ]);

    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    let wake_at = h
        .store
        .get_run(&run.id)
        .await
        .unwrap()
        .unwrap()
        .checkpoint
        .wake_at
        .unwrap();
    // One millisecond short of due: the sweep must not resume it. `notify` has
    // no handler installed, so resuming here would panic the FakePorts default.
    engine.sweep_due(wake_at - 1).await.unwrap();

    let still = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(still.status, RunStatus::Waiting);
    assert_eq!(still.checkpoint.steps["pause"].status, StepStatus::Waiting);
}

#[tokio::test]
async fn resumes_and_runs_the_following_step_once_the_wake_at_is_due() {
    let h = harness().await;
    let ports = FakePorts {
        notify: Box::new(|step, _ctx| completed(outputs(&[("sent", json!(step.id))]))),
        ..FakePorts::default()
    };
    let engine = Arc::new(h.interpreter(ports));
    let def = definition(vec![
        wait_step("pause", 300),
        notify_step("after", vec![text("x")]),
    ]);

    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();
    let wake_at = h
        .store
        .get_run(&run.id)
        .await
        .unwrap()
        .unwrap()
        .checkpoint
        .wake_at
        .unwrap();

    engine.sweep_due(wake_at).await.unwrap();

    // The resume detaches its advance so one slow run can't stall the sweep,
    // so settle on the terminal status rather than reading straight through.
    let finished = settle(&h, &run.id, RunStatus::Succeeded).await;
    assert_eq!(
        finished.checkpoint.steps["pause"].status,
        StepStatus::Succeeded
    );
    assert_eq!(
        finished.checkpoint.steps["after"].outputs,
        Some(outputs(&[("sent", json!("after"))]))
    );
    assert_eq!(
        finished.checkpoint.wake_at, None,
        "the resumed wait must disarm its wake_at"
    );
}

#[tokio::test]
async fn a_resumed_wait_reaches_the_run_view_via_the_next_park() {
    let h = harness().await;
    let engine = Arc::new(h.interpreter(FakePorts::default()));
    let def = definition(vec![wait_step("first", 300), wait_step("second", 300)]);

    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();
    let first_wake = h
        .store
        .get_run(&run.id)
        .await
        .unwrap()
        .unwrap()
        .checkpoint
        .wake_at
        .unwrap();

    let before = h.sink.run_updates().len();
    engine.sweep_due(first_wake).await.unwrap();

    // A wait settles outside the walk, so it emits nothing of its own — the
    // update reaches the view when the resumed advance parks on `second` and
    // emits the whole run record, `first` already succeeded inside it. Pinning
    // that here because the alternative (an emit in `resume_wait`) is the
    // obvious-looking fix, and it would double every update.
    for _ in 0..100 {
        if h.sink.run_updates().len() > before {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    panic!("resuming a wait emitted no run update");
}
