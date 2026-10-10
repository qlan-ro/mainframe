//! The preservation rules every checkpoint writer relies on.

use serde_json::{Map, Value, json};

use super::super::test_support::step_entry;
use super::super::{AutomationCheckpoint, CheckpointStep, RunTriggerContext, StepKind, StepStatus};
use crate::domain::AutomationDefinition;

fn checkpoint() -> AutomationCheckpoint {
    AutomationCheckpoint::new(
        AutomationDefinition {
            triggers: vec![],
            steps: vec![],
        },
        RunTriggerContext::manual(),
    )
}

fn waiting(wake_at: Option<i64>) -> CheckpointStep {
    let mut entry = step_entry("agent", StepStatus::Waiting);
    entry.kind = StepKind::AskAgent;
    entry.wake_at = wake_at;
    entry
}

fn outputs(value: &str) -> Map<String, Value> {
    Map::from_iter([("result".to_string(), json!(value))])
}

#[test]
fn a_failed_rerun_keeps_earlier_outputs_and_what_the_verb_stamped() {
    let mut cp = checkpoint();
    let mut earlier = step_entry("agent", StepStatus::Succeeded);
    earlier.kind = StepKind::AskAgent;
    earlier.outputs = Some(outputs("first"));
    earlier.started_at = Some(42);
    earlier.chat_id = Some("chat-1".into());
    earlier.interaction_id = Some("ix-1".into());
    cp.steps.insert("agent".into(), earlier);

    cp.set_step(
        "agent",
        "agent",
        StepKind::AskAgent,
        StepStatus::Failed,
        Some(outputs("ignored")),
        Some("boom".into()),
        Some(900),
    );

    let entry = &cp.steps["agent"];
    assert_eq!(entry.status, StepStatus::Failed);
    assert_eq!(entry.outputs, Some(outputs("first")));
    assert_eq!(entry.error.as_deref(), Some("boom"));
    assert_eq!(entry.started_at, Some(42));
    assert!(entry.finished_at.is_some());
    assert_eq!(entry.chat_id.as_deref(), Some("chat-1"));
    assert_eq!(entry.interaction_id.as_deref(), Some("ix-1"));
    assert_eq!(entry.wake_at, Some(900));
}

#[test]
fn a_success_replaces_outputs_and_a_running_entry_has_no_finish_time() {
    let mut cp = checkpoint();

    cp.set_step(
        "run#0",
        "run",
        StepKind::RunAction,
        StepStatus::Running,
        Some(outputs("dropped")),
        None,
        None,
    );
    let running = &cp.steps["run#0"];
    assert_eq!(running.kind, StepKind::RunAction);
    assert_eq!(running.step_id, "run");
    assert_eq!(running.outputs, None);
    assert_eq!(running.finished_at, None);
    let started = running.started_at;
    assert!(started.is_some());

    cp.set_step(
        "run#0",
        "run",
        StepKind::RunAction,
        StepStatus::Succeeded,
        Some(outputs("done")),
        None,
        None,
    );
    let done = &cp.steps["run#0"];
    assert_eq!(done.outputs, Some(outputs("done")));
    assert_eq!(done.started_at, started);
    assert!(done.finished_at.is_some());
}

#[test]
fn failing_an_entry_clears_its_deadline_and_never_creates_one() {
    let mut cp = checkpoint();
    cp.steps.insert("agent".into(), waiting(Some(500)));

    cp.fail_step_entry("agent", "agent step deadline exceeded");
    cp.fail_step_entry("missing", "ignored");

    let entry = &cp.steps["agent"];
    assert_eq!(entry.status, StepStatus::Failed);
    assert_eq!(entry.error.as_deref(), Some("agent step deadline exceeded"));
    assert_eq!(entry.wake_at, None);
    assert!(entry.finished_at.is_some());
    assert!(!cp.steps.contains_key("missing"));
}

#[test]
fn the_run_deadline_is_the_earliest_still_waiting_entry() {
    let mut cp = checkpoint();
    cp.steps.insert("a".into(), waiting(Some(900)));
    cp.steps.insert("b".into(), waiting(Some(700)));
    cp.steps.insert("c".into(), waiting(None));
    let mut settled = waiting(Some(100));
    settled.status = StepStatus::Succeeded;
    cp.steps.insert("d".into(), settled);

    cp.recompute_wake_at();
    assert_eq!(cp.wake_at, Some(700));

    cp.steps.remove("a");
    cp.steps.remove("b");
    cp.recompute_wake_at();
    assert_eq!(cp.wake_at, None);
}

#[test]
fn parking_a_new_step_arms_the_run_deadline_without_lowering_a_sibling() {
    let mut cp = checkpoint();
    cp.steps.insert("a".into(), waiting(Some(400)));

    cp.park_step("b", "agent", StepKind::AskAgent, Some(800));

    let entry = &cp.steps["b"];
    assert_eq!(entry.status, StepStatus::Waiting);
    assert_eq!(entry.kind, StepKind::AskAgent);
    assert_eq!(entry.wake_at, Some(800));
    assert_eq!(entry.finished_at, None);
    assert_eq!(cp.wake_at, Some(400));
}

#[test]
fn succeeding_a_waiting_entry_keeps_the_sibling_deadline() {
    let mut cp = checkpoint();
    cp.steps.insert("a".into(), waiting(Some(500)));
    cp.steps.insert("b".into(), waiting(Some(900)));
    cp.wake_at = Some(500);

    assert!(cp.succeed_waiting_step("a", Some(outputs("done"))));

    let entry = &cp.steps["a"];
    assert_eq!(entry.status, StepStatus::Succeeded);
    assert_eq!(entry.outputs, Some(outputs("done")));
    assert_eq!(entry.wake_at, None);
    assert!(entry.finished_at.is_some());
    assert_eq!(cp.wake_at, Some(900));
}

#[test]
fn a_settled_or_missing_entry_is_not_settled_again() {
    let mut cp = checkpoint();
    let mut settled = waiting(None);
    settled.status = StepStatus::Failed;
    settled.error = Some("deadline".into());
    cp.steps.insert("a".into(), settled);

    assert!(!cp.succeed_waiting_step("a", Some(outputs("late"))));
    assert!(!cp.succeed_waiting_step("missing", None));

    let entry = &cp.steps["a"];
    assert_eq!(entry.status, StepStatus::Failed);
    assert_eq!(entry.error.as_deref(), Some("deadline"));
    assert_eq!(entry.outputs, None);
    assert!(!cp.steps.contains_key("missing"));
}

#[test]
fn parking_never_reopens_a_terminal_entry() {
    let mut cp = checkpoint();
    let mut done = waiting(None);
    done.status = StepStatus::Succeeded;
    cp.steps.insert("a".into(), done);

    cp.park_step("a", "agent", StepKind::AskAgent, Some(700));

    assert_eq!(cp.steps["a"].status, StepStatus::Succeeded);
    assert_eq!(cp.steps["a"].wake_at, None);
    assert_eq!(cp.wake_at, None);
}
