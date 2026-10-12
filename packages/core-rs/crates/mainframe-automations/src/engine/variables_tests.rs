//! `$name` substitution end-to-end through the interpreter: the name
//! index a run resolves against is the scope walk's, so a repeat body's
//! producers never shadow a later sibling's.

use std::sync::{Arc, Mutex};

use serde_json::json;

use crate::domain::LoopMode;
use crate::store::RunStatus;
use crate::tokens;

use super::test_support::{
    FakePorts, ask_agent_step, completed, cond_is, definition, empty_outputs, harness, loop_step,
    manual, manual_with_payload, notify_step, parallel_step, repeat_step, retry_step,
    set_variable_step, text, token_ref,
};

fn rendering_ports(rendered: Arc<Mutex<Vec<String>>>) -> FakePorts {
    FakePorts {
        notify: Box::new(move |step, ctx| {
            rendered
                .lock()
                .unwrap()
                .push(tokens::render(&step.message, ctx.scope, ctx.names));
            completed(empty_outputs())
        }),
        // Each agent reports its own step id, so the assertion names the
        // step whose value was substituted.
        ask_agent: Box::new(|step, _| {
            completed(
                [("result".to_string(), json!(step.id))]
                    .into_iter()
                    .collect(),
            )
        }),
        ..FakePorts::default()
    }
}

#[tokio::test]
async fn a_set_variable_binds_a_name_and_an_unknown_name_stays_literal() {
    let h = harness().await;
    let rendered = Arc::new(Mutex::new(Vec::new()));
    let engine = h.interpreter(rendering_ports(rendered.clone()));
    let def = definition(vec![
        set_variable_step("set-headline", "headline", vec![text("Release v2")]),
        notify_step("n", vec![text("$headline / $missing")]),
    ]);

    let run = engine
        .start_run(&h.automation_id, def, manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    assert_eq!(
        h.store.get_run(&run.id).await.unwrap().unwrap().status,
        RunStatus::Succeeded
    );
    assert_eq!(
        rendered.lock().unwrap().as_slice(),
        ["Release v2 / $missing"]
    );
}

#[tokio::test]
async fn item_renders_the_current_iteration_element() {
    let h = harness().await;
    let rendered = Arc::new(Mutex::new(Vec::new()));
    let engine = h.interpreter(rendering_ports(rendered.clone()));
    let def = definition(vec![repeat_step(
        "loop",
        token_ref("trigger", "people", None),
        vec![notify_step("greet", vec![text("Hi $item.name")])],
    )]);

    let run = engine
        .start_run(
            &h.automation_id,
            def,
            manual_with_payload(json!({"people": [{"name": "Ada"}, {"name": "Lin"}]})),
            None,
        )
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    assert_eq!(rendered.lock().unwrap().as_slice(), ["Hi Ada", "Hi Lin"]);
}

#[tokio::test]
async fn agent_result_after_a_repeat_block_resolves_the_later_sibling() {
    let h = harness().await;
    let rendered = Arc::new(Mutex::new(Vec::new()));
    let engine = h.interpreter(rendering_ports(rendered.clone()));
    let def = definition(vec![
        repeat_step(
            "loop",
            token_ref("trigger", "items", None),
            vec![ask_agent_step("inner", false)],
        ),
        ask_agent_step("outer", false),
        notify_step("n", vec![text("$agent_result")]),
    ]);

    let run = engine
        .start_run(
            &h.automation_id,
            def,
            manual_with_payload(json!({"items": ["only"]})),
            None,
        )
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    assert_eq!(
        rendered.lock().unwrap().as_slice(),
        ["outer"],
        "a flat name sweep would have substituted the repeat body's agent"
    );
}

/// Runs `steps` to completion behind a `headline` variable bound before them,
/// returning every notify message in the order it rendered.
async fn render_after_headline(steps: Vec<crate::domain::Step>) -> Vec<String> {
    let h = harness().await;
    let rendered = Arc::new(Mutex::new(Vec::new()));
    let engine = h.interpreter(rendering_ports(rendered.clone()));
    let mut all = vec![set_variable_step(
        "set-headline",
        "headline",
        vec![text("Release v2")],
    )];
    all.extend(steps);

    let run = engine
        .start_run(&h.automation_id, definition(all), manual(), None)
        .await
        .unwrap();
    engine.advance(&run.id).await.unwrap();

    assert_eq!(
        h.store.get_run(&run.id).await.unwrap().unwrap().status,
        RunStatus::Succeeded
    );
    rendered.lock().unwrap().clone()
}

#[tokio::test]
async fn a_loop_body_renders_names_from_outside_and_inside_the_block() {
    let rendered = render_after_headline(vec![loop_step(
        "poll",
        LoopMode::Until,
        vec![cond_is("set-status", "value", "green")],
        3,
        vec![
            set_variable_step("set-status", "status", vec![text("green")]),
            notify_step("n", vec![text("$headline is $status")]),
        ],
    )])
    .await;

    assert_eq!(rendered, ["Release v2 is green"]);
}

#[tokio::test]
async fn a_retry_body_renders_names_from_outside_and_inside_the_block() {
    let rendered = render_after_headline(vec![retry_step(
        "attempts",
        2,
        vec![
            set_variable_step("set-status", "status", vec![text("shipped")]),
            notify_step("n", vec![text("$headline was $status")]),
        ],
    )])
    .await;

    assert_eq!(rendered, ["Release v2 was shipped"]);
}

#[tokio::test]
async fn every_parallel_branch_renders_names_from_outside_and_inside_the_block() {
    let rendered = render_after_headline(vec![parallel_step(
        "fan",
        vec![
            vec![notify_step("left", vec![text("left: $headline")])],
            vec![
                set_variable_step("set-side", "side", vec![text("right")]),
                notify_step("right", vec![text("$side: $headline")]),
            ],
        ],
    )])
    .await;

    let mut sorted = rendered;
    sorted.sort();
    assert_eq!(sorted, ["left: Release v2", "right: Release v2"]);
}
