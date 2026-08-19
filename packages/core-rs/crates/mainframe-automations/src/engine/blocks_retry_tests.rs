//! Retry (Part 3 Phase 3). The load-bearing detail is that attempts cannot be
//! inferred by replaying the walk — `walk_frame` skips an already-`failed`
//! entry — so each attempt gets its own frame plus a marker recording its
//! outcome. These tests pin both halves.

use std::sync::{Arc, Mutex};

use serde_json::json;

use crate::store::{RunStatus, StepStatus};

use super::markers::RETRY_ATTEMPT_KIND;
use super::test_support::{
    FakePorts, completed, definition, failed, harness, manual, notify_step, retry_step, text,
};

/// A notify port that fails its first `failures` calls, then succeeds.
fn flaky(failures: usize, calls: Arc<Mutex<usize>>) -> FakePorts {
    FakePorts {
        notify: Box::new(move |step, _ctx| {
            let mut n = calls.lock().unwrap();
            *n += 1;
            if *n <= failures {
                failed(format!("attempt {} blew up", *n))
            } else {
                completed([("ok".to_string(), json!(step.id))].into_iter().collect())
            }
        }),
        ..FakePorts::default()
    }
}

#[tokio::test]
async fn a_body_that_fails_once_succeeds_on_the_second_attempt() {
    let h = harness().await;
    let calls = Arc::new(Mutex::new(0));
    let engine = h.interpreter(flaky(1, calls.clone()));
    let def = definition(vec![retry_step(
        "guard",
        3,
        vec![notify_step("flaky", vec![text("go")])],
    )]);

    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Succeeded);
    assert_eq!(*calls.lock().unwrap(), 2);
    // Each attempt writes into its own frame, so the first failure survives
    // alongside the second attempt's success rather than being overwritten.
    assert_eq!(
        finished.checkpoint.steps["flaky#0"].status,
        StepStatus::Failed
    );
    assert_eq!(
        finished.checkpoint.steps["flaky#1"].status,
        StepStatus::Succeeded
    );
}

#[tokio::test]
async fn a_body_that_always_fails_stops_at_the_attempt_ceiling_and_reports_the_last_error() {
    let h = harness().await;
    let calls = Arc::new(Mutex::new(0));
    let engine = h.interpreter(flaky(99, calls.clone()));
    let def = definition(vec![retry_step(
        "guard",
        3,
        vec![notify_step("flaky", vec![text("go")])],
    )]);

    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Failed);
    assert_eq!(*calls.lock().unwrap(), 3);
    let error = finished.checkpoint.error.clone().unwrap();
    assert!(
        error.contains("attempt 3"),
        "the run must carry the LAST attempt's error, got {error:?}"
    );
}

#[tokio::test]
async fn one_attempt_means_no_retry() {
    let h = harness().await;
    let calls = Arc::new(Mutex::new(0));
    let engine = h.interpreter(flaky(99, calls.clone()));
    let def = definition(vec![retry_step(
        "guard",
        1,
        vec![notify_step("flaky", vec![text("go")])],
    )]);

    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    assert_eq!(*calls.lock().unwrap(), 1);
    assert_eq!(
        h.store.get_run(&run.id).await.unwrap().unwrap().status,
        RunStatus::Failed
    );
}

#[tokio::test]
async fn re_advancing_does_not_re_run_a_settled_retry() {
    // The replay hazard this block exists to survive: `walk_frame` treats an
    // already-`failed` entry as settled, so without the attempt markers a
    // second advance would walk the failed attempt, skip its failed step, and
    // report the retry as a success.
    let h = harness().await;
    let calls = Arc::new(Mutex::new(0));
    let engine = h.interpreter(flaky(1, calls.clone()));
    let def = definition(vec![retry_step(
        "guard",
        3,
        vec![notify_step("flaky", vec![text("go")])],
    )]);

    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();
    let after_first = *calls.lock().unwrap();

    engine.advance(&run.id).await.unwrap();

    assert_eq!(
        *calls.lock().unwrap(),
        after_first,
        "a settled retry must not run its body again"
    );
    assert_eq!(
        h.store.get_run(&run.id).await.unwrap().unwrap().status,
        RunStatus::Succeeded
    );
}

#[tokio::test]
async fn attempt_markers_are_engine_state_not_user_steps() {
    let h = harness().await;
    let calls = Arc::new(Mutex::new(0));
    let engine = h.interpreter(flaky(1, calls.clone()));
    let def = definition(vec![retry_step(
        "guard",
        3,
        vec![notify_step("flaky", vec![text("go")])],
    )]);

    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    let markers: Vec<_> = finished
        .checkpoint
        .steps
        .values()
        .filter(|e| e.kind == RETRY_ATTEMPT_KIND)
        .collect();
    assert_eq!(markers.len(), 2, "one marker per consumed attempt");
    // The route filters on this kind; if it ever changed, the run view would
    // look up a verb that does not exist.
    assert!(markers.iter().all(|e| e.kind == "retry_attempt"));
}

#[tokio::test]
async fn keep_going_lets_the_run_continue_past_an_exhausted_retry() {
    let h = harness().await;
    let calls = Arc::new(Mutex::new(0));
    let ports = FakePorts {
        notify: Box::new(move |step, _ctx| {
            let mut n = calls.lock().unwrap();
            *n += 1;
            if step.id == "flaky" {
                failed("nope".to_string())
            } else {
                completed([("ok".to_string(), json!(step.id))].into_iter().collect())
            }
        }),
        ..FakePorts::default()
    };
    let engine = h.interpreter(ports);
    let mut retry = retry_step("guard", 2, vec![notify_step("flaky", vec![text("go")])]);
    if let crate::domain::Step::Retry(block) = &mut retry {
        block.keep_going = true;
    }
    let def = definition(vec![retry, notify_step("after", vec![text("done")])]);

    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(
        finished.checkpoint.steps["after"].status,
        StepStatus::Succeeded,
        "keepGoing on the retry block carries the run past its exhaustion"
    );
}
