//! The watermark scheduler (`blocks_concurrent_repeat.rs`). The load-bearing
//! case: `branch_started`'s old string-prefix match treated ANY checkpoint
//! entry sharing a `#<i>` suffix as evidence a branch had started, so a
//! sequential repeat elsewhere in the automation could make every branch of
//! an unrelated concurrent repeat read as already-started and skip the
//! concurrency budget entirely. The watermark replaces that with a durable
//! counter, so these tests pin the budget under exactly that collision.

use std::sync::{Arc, Mutex};

use serde_json::json;

use crate::store::{RunStatus, StepStatus};

use super::test_support::{
    FakePorts, ask_agent_step, completed, concurrent_repeat_step, definition, empty_outputs,
    harness, manual_with_payload, notify_step, repeat_step, text, token, token_ref,
};
use super::{StepOutcome, VerbContext};

#[tokio::test]
async fn a_sequential_repeat_sharing_suffixes_does_not_unlock_the_concurrency_budget() {
    // "warmup" is a SEQUENTIAL repeat over the same list, so it writes plain
    // leaf entries "ping#0", "ping#1", ... before "fanout" (concurrency: 2)
    // even starts. A naive suffix match would read "ping#0" as fanout's own
    // branch 0 already outstanding.
    let h = harness().await;
    let notify_calls = Arc::new(Mutex::new(Vec::<String>::new()));
    let seen_notify = notify_calls.clone();
    let agent_calls = Arc::new(Mutex::new(Vec::<String>::new()));
    let seen_agent = agent_calls.clone();
    let ports = FakePorts {
        notify: Box::new(move |step, _ctx| {
            seen_notify.lock().unwrap().push(step.id.clone());
            completed(empty_outputs())
        }),
        ask_agent: Box::new(move |_step, ctx: &VerbContext<'_>| {
            seen_agent.lock().unwrap().push(ctx.step_ref.to_string());
            StepOutcome::Wait { wake_at: None }
        }),
        ..FakePorts::default()
    };
    let engine = h.interpreter(ports);
    let def = definition(vec![
        repeat_step(
            "warmup",
            token_ref("trigger", "items", None),
            vec![notify_step(
                "ping",
                vec![text("ping "), token("current", "item", None)],
            )],
        ),
        concurrent_repeat_step(
            "fanout",
            token_ref("trigger", "items", None),
            2,
            vec![ask_agent_step("agent", false)],
        ),
    ]);
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

    assert_eq!(
        *notify_calls.lock().unwrap(),
        vec!["ping", "ping", "ping"],
        "warmup must fully complete before fanout starts"
    );
    assert_eq!(
        *agent_calls.lock().unwrap(),
        vec!["agent#0", "agent#1"],
        "only the concurrency:2 budget worth of branches may start, despite \
         warmup's ping#0/ping#1 sharing the same #<i> suffixes"
    );
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
    assert!(
        !parked.checkpoint.steps.contains_key("agent#2"),
        "the third branch must stay excluded while the budget is spent"
    );
}
