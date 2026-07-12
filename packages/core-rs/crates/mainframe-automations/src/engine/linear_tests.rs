//! T4.1 — linear walk over the frozen checkpoint definition (Node parity:
//! engine-linear.test.ts).

use std::sync::{Arc, Mutex};

use rusqlite::params;
use serde_json::json;

use crate::store::{RunStatus, StepStatus};
use crate::tokens;

use super::StepOutcome;
use super::test_support::{
    FakePorts, ask_me_step, completed, definition, empty_outputs, harness, manual, notify_step,
    run_action_step, text, token,
};

fn outputs(pairs: &[(&str, serde_json::Value)]) -> serde_json::Map<String, serde_json::Value> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.clone()))
        .collect()
}

#[tokio::test]
async fn runs_steps_sequentially_and_records_outputs_by_step_ref() {
    let h = harness().await;
    let order = Arc::new(Mutex::new(Vec::<String>::new()));
    let seen = order.clone();
    let ports = FakePorts {
        notify: Box::new(move |step, _ctx| {
            seen.lock().unwrap().push(step.id.clone());
            completed(outputs(&[("sent", json!(step.id))]))
        }),
        ..FakePorts::default()
    };
    let engine = h.interpreter(ports);
    let def = definition(vec![
        notify_step("step-a", vec![text("a")]),
        notify_step("step-b", vec![text("b")]),
    ]);
    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    assert_eq!(*order.lock().unwrap(), vec!["step-a", "step-b"]);
    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Succeeded);
    assert_eq!(
        finished.checkpoint.steps["step-a"].outputs,
        Some(outputs(&[("sent", json!("step-a"))]))
    );
    assert_eq!(
        finished.checkpoint.steps["step-b"].outputs,
        Some(outputs(&[("sent", json!("step-b"))]))
    );
}

#[tokio::test]
async fn walks_the_frozen_checkpoint_definition_never_the_live_row() {
    let h = harness().await;
    let ports = FakePorts {
        notify: Box::new(|_, _| completed(empty_outputs())),
        ..FakePorts::default()
    };
    let engine = h.interpreter(ports);
    let original = definition(vec![notify_step("only", vec![text("x")])]);
    let run = engine
        .start_run(&h.automation_id, original.clone(), manual(), None)
        .await
        .unwrap();

    // Mutate the live `automations` row mid-run — the frozen snapshot wins.
    let mutated = serde_json::to_string(&definition(vec![
        notify_step("only", vec![text("x")]),
        notify_step("sneaky", vec![text("should never run")]),
    ]))
    .unwrap();
    let automation_id = h.automation_id.clone();
    h.db.call(move |conn| {
        conn.execute(
            "UPDATE automations SET definition = ?1 WHERE id = ?2",
            params![mutated, automation_id],
        )?;
        Ok(())
    })
    .await
    .unwrap();

    engine.advance(&run.id).await.unwrap();

    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Succeeded);
    assert_eq!(
        finished.checkpoint.steps.keys().collect::<Vec<_>>(),
        vec!["only"]
    );
    assert_eq!(finished.checkpoint.definition, original);
}

#[tokio::test]
async fn failed_step_fails_the_run_and_records_the_error() {
    let h = harness().await;
    let ports = FakePorts {
        run_action: Box::new(|_, _| StepOutcome::Failed {
            error: "boom exploded".to_string(),
        }),
        ..FakePorts::default()
    };
    let engine = h.interpreter(ports);
    let def = definition(vec![run_action_step("run-1", "boom", false)]);
    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Failed);
    assert_eq!(
        finished.checkpoint.error.as_deref(),
        Some("boom exploded"),
        "run.error carries the failing step's message"
    );
    assert_eq!(
        finished.checkpoint.steps["run-1"].status,
        StepStatus::Failed
    );
}

#[tokio::test]
async fn keep_going_records_the_failure_continues_and_downstream_tokens_render_empty() {
    let h = harness().await;
    let ports = FakePorts {
        run_action: Box::new(|_, _| StepOutcome::Failed {
            error: "boom exploded".to_string(),
        }),
        notify: Box::new(|step, ctx| {
            completed(
                [(
                    "rendered".to_string(),
                    json!(tokens::render(&step.message, ctx.scope)),
                )]
                .into_iter()
                .collect(),
            )
        }),
        ..FakePorts::default()
    };
    let engine = h.interpreter(ports);
    let def = definition(vec![
        run_action_step("run-1", "boom", true),
        notify_step(
            "notify-1",
            vec![text("Result: "), token("run-1", "output", None), text(".")],
        ),
    ]);
    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Succeeded);
    assert_eq!(
        finished.checkpoint.steps["run-1"].status,
        StepStatus::Failed
    );
    assert_eq!(
        finished.checkpoint.steps["run-1"].error.as_deref(),
        Some("boom exploded")
    );
    assert_eq!(
        finished.checkpoint.steps["notify-1"].outputs,
        Some(outputs(&[("rendered", json!("Result: ."))]))
    );
}

#[tokio::test]
async fn emits_run_updated_after_each_leaf_step_settles_not_just_start_and_finalize() {
    let h = harness().await;
    let ports = FakePorts {
        notify: Box::new(|_, _| completed(empty_outputs())),
        ..FakePorts::default()
    };
    let engine = h.interpreter(ports);
    let def = definition(vec![
        notify_step("step-a", vec![text("a")]),
        notify_step("step-b", vec![text("b")]),
    ]);
    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    // A6: start, step-a settled, step-b settled, finalize.
    let updates = h.sink.run_updates();
    assert_eq!(updates.len(), 4);
    assert_eq!(updates[0].status, RunStatus::Running);
    assert_eq!(updates.last().unwrap().status, RunStatus::Succeeded);
}

#[tokio::test]
async fn emits_on_park_and_resumes_to_finalize_after_external_resolution() {
    let h = harness().await;
    let wake_at = crate::store::epoch_ms_now() + 60_000;
    let ports = FakePorts {
        ask_me: Box::new(move |_, _| StepOutcome::Wait {
            wake_at: Some(wake_at),
        }),
        ..FakePorts::default()
    };
    let engine = h.interpreter(ports);
    let def = definition(vec![ask_me_step("wait-1")]);
    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    let updates = h.sink.run_updates();
    assert!(updates.len() >= 2, "start + park");
    assert_eq!(updates.last().unwrap().status, RunStatus::Waiting);

    // Resolve externally (as a real ask_me respond() would), then advance.
    h.store
        .patch_checkpoint(&run.id, |cp| {
            if let Some(entry) = cp.steps.get_mut("wait-1") {
                entry.status = StepStatus::Succeeded;
                entry.outputs = Some(serde_json::Map::new());
                entry.finished_at = Some(1);
            }
            cp.wake_at = None;
        })
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    let updates = h.sink.run_updates();
    assert_eq!(updates.last().unwrap().status, RunStatus::Succeeded);
}

#[tokio::test]
async fn advance_is_a_noop_on_an_already_terminal_run() {
    let h = harness().await;
    let engine = h.interpreter(FakePorts::default());
    let run = engine
        .start_run(&h.automation_id, definition(vec![]), manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();
    assert_eq!(
        h.store.get_run(&run.id).await.unwrap().unwrap().status,
        RunStatus::Succeeded
    );

    h.sink.events.lock().unwrap().clear();
    engine.advance(&run.id).await.unwrap();
    assert!(h.sink.events.lock().unwrap().is_empty());
}
