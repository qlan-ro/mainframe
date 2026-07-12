//! T4.2 — If blocks: branch pick, nesting, and scope visibility (Node
//! parity: engine-blocks.test.ts).

use std::sync::{Arc, Mutex};

use serde_json::json;

use crate::store::RunStatus;
use crate::tokens;

use super::test_support::{
    FakePorts, completed, definition, harness, if_step, manual_with_payload, notify_step, text,
    token,
};

fn recording_ports(seen: Arc<Mutex<Vec<String>>>, rendered: Arc<Mutex<Vec<String>>>) -> FakePorts {
    FakePorts {
        notify: Box::new(move |step, ctx| {
            seen.lock().unwrap().push(step.id.clone());
            rendered
                .lock()
                .unwrap()
                .push(tokens::render(&step.message, ctx.scope));
            completed(
                [("tag".to_string(), json!(format!("took-{}", step.id)))]
                    .into_iter()
                    .collect(),
            )
        }),
        ..FakePorts::default()
    }
}

#[tokio::test]
async fn picks_then_when_conditions_match_otherwise_the_otherwise_branch() {
    let h = harness().await;
    let seen = Arc::new(Mutex::new(Vec::new()));
    let engine = h.interpreter(recording_ports(seen.clone(), Arc::default()));
    let def = definition(vec![if_step(
        "gate",
        vec![super::test_support::cond_is("trigger", "scope", "big")],
        vec![notify_step("then-step", vec![text("big path")])],
        vec![notify_step("else-step", vec![text("small path")])],
    )]);

    let big = engine
        .start_run(
            &h.automation_id,
            def.clone(),
            manual_with_payload(json!({"scope": "big"})),
            None,
        )
        .await
        .unwrap();
    engine.advance(&big.id).await.unwrap();
    assert_eq!(*seen.lock().unwrap(), vec!["then-step"]);
    let finished = h.store.get_run(&big.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Succeeded);
    assert!(!finished.checkpoint.steps.contains_key("else-step"));
    assert!(!finished.checkpoint.steps.contains_key("gate"));

    seen.lock().unwrap().clear();
    let small = engine
        .start_run(
            &h.automation_id,
            def,
            manual_with_payload(json!({"scope": "small"})),
            None,
        )
        .await
        .unwrap();
    engine.advance(&small.id).await.unwrap();
    assert_eq!(*seen.lock().unwrap(), vec!["else-step"]);
    let finished = h.store.get_run(&small.id).await.unwrap().unwrap();
    assert!(!finished.checkpoint.steps.contains_key("then-step"));
}

#[tokio::test]
async fn supports_a_nested_if_inside_the_otherwise_branch() {
    let h = harness().await;
    let seen = Arc::new(Mutex::new(Vec::new()));
    let engine = h.interpreter(recording_ports(seen.clone(), Arc::default()));
    let def = definition(vec![if_step(
        "outer",
        vec![super::test_support::cond_is("trigger", "scope", "xs")],
        vec![notify_step("xs-step", vec![text("xs")])],
        vec![if_step(
            "inner",
            vec![super::test_support::cond_is("trigger", "scope", "s")],
            vec![notify_step("s-step", vec![text("s")])],
            vec![notify_step("other-step", vec![text("other")])],
        )],
    )]);
    let run = engine
        .start_run(
            &h.automation_id,
            def,
            manual_with_payload(json!({"scope": "s"})),
            None,
        )
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    assert_eq!(*seen.lock().unwrap(), vec!["s-step"]);
    assert_eq!(
        h.store.get_run(&run.id).await.unwrap().unwrap().status,
        RunStatus::Succeeded
    );
}

#[tokio::test]
async fn taken_branch_outputs_are_visible_to_later_outer_siblings_untaken_render_empty() {
    let h = harness().await;
    let rendered = Arc::new(Mutex::new(Vec::new()));
    let engine = h.interpreter(recording_ports(Arc::default(), rendered.clone()));
    let def = definition(vec![
        if_step(
            "gate",
            vec![super::test_support::cond_is("trigger", "scope", "big")],
            vec![notify_step("then-step", vec![text("big path")])],
            vec![notify_step("else-step", vec![text("small path")])],
        ),
        notify_step(
            "after-step",
            vec![
                text("T:"),
                token("then-step", "tag", None),
                text(" E:"),
                token("else-step", "tag", None),
            ],
        ),
    ]);
    let run = engine
        .start_run(
            &h.automation_id,
            def,
            manual_with_payload(json!({"scope": "big"})),
            None,
        )
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Succeeded);
    // Taken-branch output resolves; the untaken branch renders empty.
    assert_eq!(
        rendered.lock().unwrap().last().unwrap(),
        "T:took-then-step E:"
    );
}
