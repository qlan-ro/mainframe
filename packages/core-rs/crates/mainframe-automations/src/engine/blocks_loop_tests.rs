//! Condition loops + `break` (Part 3 Phase 2). What separates a loop from a
//! Repeat is that the continue test is re-evaluated every pass against a
//! freshly built scope, so these tests drive it from a body step's own output.

use std::sync::{Arc, Mutex};

use serde_json::json;

use crate::domain::LoopMode;
use crate::store::{RunStatus, StepStatus};

use super::test_support::{
    FakePorts, break_step, completed, cond_is, definition, harness, loop_step, manual, notify_step,
    set_variable_step, text, token_ref,
};

/// A notify port whose Nth call reports `values[N]` as its `state` output, so a
/// loop condition reading `⟨probe.state⟩` sees a different answer each pass —
/// the polling shape the block exists for.
fn probe_ports(values: Vec<&'static str>, calls: Arc<Mutex<usize>>) -> FakePorts {
    FakePorts {
        notify: Box::new(move |_step, _ctx| {
            let mut n = calls.lock().unwrap();
            let value = values.get(*n).copied().unwrap_or("pending");
            *n += 1;
            completed([("state".to_string(), json!(value))].into_iter().collect())
        }),
        ..FakePorts::default()
    }
}

#[tokio::test]
async fn until_stops_on_the_pass_whose_body_satisfies_the_condition() {
    let h = harness().await;
    let calls = Arc::new(Mutex::new(0));
    let engine = h.interpreter(probe_ports(
        vec!["pending", "pending", "green"],
        calls.clone(),
    ));
    let def = definition(vec![loop_step(
        "poll",
        LoopMode::Until,
        vec![cond_is("probe", "state", "green")],
        10,
        vec![notify_step("probe", vec![text("check")])],
    )]);

    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Succeeded);
    // Three passes: the third produced "green", so the fourth test exits.
    assert_eq!(*calls.lock().unwrap(), 3);
    assert!(finished.checkpoint.steps.contains_key("probe#2"));
    assert!(!finished.checkpoint.steps.contains_key("probe#3"));
}

#[tokio::test]
async fn until_runs_its_body_zero_times_when_the_condition_already_holds() {
    let h = harness().await;
    let calls = Arc::new(Mutex::new(0));
    let engine = h.interpreter(probe_ports(vec!["green"], calls.clone()));
    // `seed` puts "green" in scope BEFORE the loop, so the pre-test sees it.
    let def = definition(vec![
        set_variable_step("seed", "state", vec![text("green")]),
        loop_step(
            "poll",
            LoopMode::Until,
            vec![cond_is("seed", "value", "green")],
            10,
            vec![notify_step("probe", vec![text("check")])],
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
        *calls.lock().unwrap(),
        0,
        "a pre-test loop must not run a body whose goal is already met"
    );
}

#[tokio::test]
async fn while_keeps_going_only_as_long_as_the_condition_matches() {
    let h = harness().await;
    let calls = Arc::new(Mutex::new(0));
    let engine = h.interpreter(probe_ports(vec!["busy", "busy", "idle"], calls.clone()));
    let def = definition(vec![
        set_variable_step("seed", "state", vec![text("busy")]),
        loop_step(
            "spin",
            LoopMode::While,
            vec![cond_is("probe", "state", "busy")],
            10,
            vec![notify_step("probe", vec![text("check")])],
        ),
    ]);

    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Succeeded);
    // The first pass runs unconditionally (nothing to test yet), then the
    // condition gates each following one: busy, busy, idle → stop.
    assert_eq!(*calls.lock().unwrap(), 3);
}

#[tokio::test]
async fn exhausting_the_iteration_cap_fails_the_run_rather_than_exiting_quietly() {
    let h = harness().await;
    let calls = Arc::new(Mutex::new(0));
    let engine = h.interpreter(probe_ports(vec!["pending"; 10], calls.clone()));
    let def = definition(vec![loop_step(
        "poll",
        LoopMode::Until,
        vec![cond_is("probe", "state", "green")],
        3,
        vec![notify_step("probe", vec![text("check")])],
    )]);

    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Failed);
    assert_eq!(*calls.lock().unwrap(), 3);
    let error = finished
        .checkpoint
        .error
        .clone()
        .expect("an exhausted loop reports why");
    assert!(
        error.contains("3 passes"),
        "the error must name the bound it hit, got {error:?}"
    );
}

#[tokio::test]
async fn break_leaves_the_loop_and_the_run_carries_on() {
    let h = harness().await;
    let calls = Arc::new(Mutex::new(0));
    let engine = h.interpreter(probe_ports(vec!["pending"; 10], calls.clone()));
    let def = definition(vec![
        loop_step(
            "poll",
            LoopMode::Until,
            vec![cond_is("probe", "state", "green")],
            10,
            vec![
                notify_step("probe", vec![text("check")]),
                break_step("stop"),
            ],
        ),
        notify_step("after", vec![text("done")]),
    ]);

    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(
        finished.status,
        RunStatus::Succeeded,
        "a broken loop completes normally — it is not a failure"
    );
    assert_eq!(
        *calls.lock().unwrap(),
        2,
        "one loop pass, then the trailing step"
    );
    assert_eq!(
        finished.checkpoint.steps["after"].status,
        StepStatus::Succeeded,
        "break leaves the loop, not the run"
    );
    assert!(!finished.checkpoint.steps.contains_key("probe#1"));
}

#[tokio::test]
async fn break_inside_an_if_arm_still_reaches_the_enclosing_loop() {
    let h = harness().await;
    let calls = Arc::new(Mutex::new(0));
    let engine = h.interpreter(probe_ports(vec!["stop"; 10], calls.clone()));
    let def = definition(vec![loop_step(
        "poll",
        LoopMode::Until,
        vec![cond_is("probe", "state", "green")],
        10,
        vec![
            notify_step("probe", vec![text("check")]),
            super::test_support::if_step(
                "check",
                vec![cond_is("probe", "state", "stop")],
                vec![break_step("stop")],
                vec![],
            ),
        ],
    )]);

    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Succeeded);
    assert_eq!(
        *calls.lock().unwrap(),
        1,
        "the break inside the if arm must unwind past it to the loop"
    );
}

#[tokio::test]
async fn a_loop_pass_does_not_bind_current_from_an_enclosing_repeat() {
    // `⟨current⟩` belongs to Repeat. A loop pass must not push a placeholder
    // onto that stack, or a loop nested in a repeat would shadow the real item.
    let h = harness().await;
    let rendered = Arc::new(Mutex::new(Vec::new()));
    let seen = rendered.clone();
    let ports = FakePorts {
        notify: Box::new(move |step, ctx| {
            seen.lock()
                .unwrap()
                .push(crate::tokens::render(&step.message, ctx.scope, ctx.names));
            completed(
                [("state".to_string(), json!("green"))]
                    .into_iter()
                    .collect(),
            )
        }),
        ..FakePorts::default()
    };
    let engine = h.interpreter(ports);
    let def = definition(vec![super::test_support::repeat_step(
        "each",
        token_ref("trigger", "people", None),
        vec![loop_step(
            "poll",
            LoopMode::Until,
            vec![cond_is("probe", "state", "green")],
            5,
            vec![notify_step(
                "probe",
                vec![super::test_support::token("current", "item", None)],
            )],
        )],
    )]);

    let run = engine
        .start_run(
            &h.automation_id,
            def,
            super::test_support::manual_with_payload(json!({"people": ["ana", "bo"]})),
            None,
        )
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    assert_eq!(
        *rendered.lock().unwrap(),
        vec!["ana", "bo"],
        "the enclosing repeat's item must still resolve inside the loop body"
    );
}
