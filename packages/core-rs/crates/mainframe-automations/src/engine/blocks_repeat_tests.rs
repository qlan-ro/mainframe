//! T4.2 — Repeat blocks: `#<i>` stepRefs, `current` isolation, the
//! MAX_REPEAT_ITEMS guard, mid-iteration parks, and nested `#i#j` chaining
//! (Node parity: engine-blocks.test.ts).

use std::sync::{Arc, Mutex};

use serde_json::json;

use crate::store::{RunStatus, StepStatus};
use crate::tokens;

use super::StepOutcome;
use super::blocks::MAX_REPEAT_ITEMS;
use super::test_support::{
    FakePorts, ask_me_step, completed, definition, empty_outputs, harness, manual_with_payload,
    notify_step, repeat_step, text, token, token_ref,
};

fn rendering_ports(rendered: Arc<Mutex<Vec<String>>>) -> FakePorts {
    FakePorts {
        notify: Box::new(move |step, ctx| {
            rendered
                .lock()
                .unwrap()
                .push(tokens::render(&step.message, ctx.scope));
            completed([("msg".to_string(), json!("hi"))].into_iter().collect())
        }),
        ..FakePorts::default()
    }
}

#[tokio::test]
async fn runs_inner_steps_per_item_with_suffixed_refs_and_current_isolation() {
    let h = harness().await;
    let rendered = Arc::new(Mutex::new(Vec::new()));
    let engine = h.interpreter(rendering_ports(rendered.clone()));
    let def = definition(vec![
        repeat_step(
            "loop",
            token_ref("trigger", "people", None),
            vec![notify_step(
                "greet",
                vec![text("Hi "), token("current", "item", Some("name"))],
            )],
        ),
        // Body outputs and `current` are invisible once the block closes.
        notify_step(
            "after",
            vec![
                text("G:"),
                token("greet", "msg", None),
                text(" C:"),
                token("current", "item", None),
            ],
        ),
    ]);
    let run = engine
        .start_run(
            &h.automation_id,
            def,
            manual_with_payload(json!({"people": [{"name": "Ada"}, {"name": "Grace"}]})),
            None,
        )
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    assert_eq!(
        *rendered.lock().unwrap(),
        vec!["Hi Ada", "Hi Grace", "G: C:"]
    );
    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Succeeded);
    assert_eq!(
        finished.checkpoint.steps["greet#0"].status,
        StepStatus::Succeeded
    );
    assert_eq!(
        finished.checkpoint.steps["greet#1"].status,
        StepStatus::Succeeded
    );
    assert!(!finished.checkpoint.steps.contains_key("greet"));
}

#[tokio::test]
async fn parks_mid_iteration_and_resumes_the_same_iteration_after_wake() {
    let h = harness().await;
    let calls = Arc::new(Mutex::new(0u32));
    let counted = calls.clone();
    let ports = FakePorts {
        ask_me: Box::new(move |_, _| {
            let mut count = counted.lock().unwrap();
            *count += 1;
            if *count == 1 {
                completed(empty_outputs())
            } else {
                StepOutcome::Wait { wake_at: None }
            }
        }),
        ..FakePorts::default()
    };
    let engine = h.interpreter(ports);
    let def = definition(vec![repeat_step(
        "loop",
        token_ref("trigger", "items", None),
        vec![ask_me_step("ask")],
    )]);
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

    assert_eq!(*calls.lock().unwrap(), 2);
    let checkpoint = h.store.get_run(&run.id).await.unwrap().unwrap().checkpoint;
    assert_eq!(checkpoint.steps["ask#0"].status, StepStatus::Succeeded);
    // ask_me never sets a wakeAt (interactions don't expire) — the run still
    // reports waiting because a checkpoint step waits (A5).
    assert_eq!(checkpoint.steps["ask#1"].status, StepStatus::Waiting);
    assert_eq!(
        h.store.get_run(&run.id).await.unwrap().unwrap().status,
        RunStatus::Waiting
    );

    // Resolve iteration 1's wait as a real respond() would, then resume.
    h.store
        .patch_checkpoint(&run.id, |cp| {
            if let Some(entry) = cp.steps.get_mut("ask#1") {
                entry.status = StepStatus::Succeeded;
                entry.outputs = Some(serde_json::Map::new());
                entry.finished_at = Some(1);
            }
            cp.wake_at = None;
        })
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    assert_eq!(*calls.lock().unwrap(), 2, "iteration 0 never re-ran");
    assert_eq!(
        h.store.get_run(&run.id).await.unwrap().unwrap().status,
        RunStatus::Succeeded
    );
}

#[tokio::test]
async fn repeat_over_an_empty_list_is_a_noop_success() {
    let h = harness().await;
    let engine = h.interpreter(FakePorts::default());
    let def = definition(vec![repeat_step(
        "loop",
        token_ref("trigger", "items", None),
        vec![notify_step("notify-1", vec![text("x")])],
    )]);
    let run = engine
        .start_run(
            &h.automation_id,
            def,
            manual_with_payload(json!({"items": []})),
            None,
        )
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Succeeded);
    assert!(finished.checkpoint.steps.is_empty());
}

#[tokio::test]
async fn fails_loudly_before_iterating_when_the_list_exceeds_max_repeat_items() {
    let h = harness().await;
    let engine = h.interpreter(FakePorts::default());
    let items: Vec<usize> = (0..=MAX_REPEAT_ITEMS).collect();
    let def = definition(vec![repeat_step(
        "loop",
        token_ref("trigger", "items", None),
        vec![notify_step("notify-1", vec![text("x")])],
    )]);
    let run = engine
        .start_run(
            &h.automation_id,
            def,
            manual_with_payload(json!({ "items": items })),
            None,
        )
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Failed);
    let error = finished.checkpoint.error.unwrap();
    assert!(error.contains("501 items"), "got: {error}");
    assert!(
        error.contains(&format!("exceeds the {MAX_REPEAT_ITEMS}-item limit")),
        "got: {error}"
    );
    assert!(finished.checkpoint.steps.is_empty());
}

#[tokio::test]
async fn a_non_list_items_token_fails_the_repeat() {
    let h = harness().await;
    let engine = h.interpreter(FakePorts::default());
    let def = definition(vec![repeat_step(
        "loop",
        token_ref("trigger", "items", None),
        vec![notify_step("notify-1", vec![text("x")])],
    )]);
    let run = engine
        .start_run(
            &h.automation_id,
            def,
            manual_with_payload(json!({"items": "not-a-list"})),
            None,
        )
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Failed);
    assert_eq!(
        finished.checkpoint.error.as_deref(),
        Some("repeat 'loop' items token did not resolve to a list")
    );
}

#[tokio::test]
async fn nested_repeats_chain_step_refs_as_i_j() {
    let h = harness().await;
    let rendered = Arc::new(Mutex::new(Vec::new()));
    let engine = h.interpreter(rendering_ports(rendered.clone()));
    let def = definition(vec![repeat_step(
        "outer",
        token_ref("trigger", "matrix", None),
        vec![repeat_step(
            "inner",
            token_ref("current", "item", Some("cells")),
            vec![notify_step("cell", vec![token("current", "item", None)])],
        )],
    )]);
    let run = engine
        .start_run(
            &h.automation_id,
            def,
            manual_with_payload(json!({
                "matrix": [{"cells": ["a", "b"]}, {"cells": ["c"]}]
            })),
            None,
        )
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    assert_eq!(*rendered.lock().unwrap(), vec!["a", "b", "c"]);
    let finished = h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Succeeded);
    let refs: Vec<&String> = finished.checkpoint.steps.keys().collect();
    assert_eq!(refs, vec!["cell#0#0", "cell#0#1", "cell#1#0"]);
}
