//! T2.2 — run status: A5 derivation (waiting from wakeAt OR any waiting
//! step), A8 terminal immutability, finalize semantics, and the 4 MB
//! per-step outputs cap.

use serde_json::Value;

use crate::error::StoreError;

use super::test_support::{harness, seed_automation, step_entry, with_step};
use super::{RunStatus, RunTriggerContext, StepStatus, TerminalStatus};

#[tokio::test]
async fn save_checkpoint_derives_waiting_from_wake_at() {
    let h = harness().await;
    let a = seed_automation(&h, "wake at").await;
    let run = h
        .runs
        .create_run(
            &a.id,
            a.definition.clone(),
            RunTriggerContext::manual(),
            None,
        )
        .await
        .unwrap();

    let mut checkpoint = run.checkpoint.clone();
    checkpoint.wake_at = Some(4_102_444_800_000);
    let updated = h.runs.save_checkpoint(&run.id, checkpoint).await.unwrap();
    assert_eq!(updated.status, RunStatus::Waiting);
}

#[tokio::test]
async fn save_checkpoint_derives_waiting_from_a_waiting_step_with_null_wake_at() {
    // A5 — ask_me parks carry wakeAt null but the run must report waiting.
    let h = harness().await;
    let a = seed_automation(&h, "form park").await;
    let run = h
        .runs
        .create_run(
            &a.id,
            a.definition.clone(),
            RunTriggerContext::manual(),
            None,
        )
        .await
        .unwrap();

    let checkpoint = with_step(
        run.checkpoint.clone(),
        "ask",
        step_entry("ask", StepStatus::Waiting),
    );
    assert_eq!(checkpoint.wake_at, None);
    let updated = h.runs.save_checkpoint(&run.id, checkpoint).await.unwrap();
    assert_eq!(updated.status, RunStatus::Waiting);
}

#[tokio::test]
async fn save_checkpoint_derives_running_when_nothing_waits() {
    let h = harness().await;
    let a = seed_automation(&h, "keeps running").await;
    let run = h
        .runs
        .create_run(
            &a.id,
            a.definition.clone(),
            RunTriggerContext::manual(),
            None,
        )
        .await
        .unwrap();

    let checkpoint = with_step(
        run.checkpoint.clone(),
        "s1",
        step_entry("s1", StepStatus::Succeeded),
    );
    let updated = h.runs.save_checkpoint(&run.id, checkpoint).await.unwrap();
    assert_eq!(updated.status, RunStatus::Running);
}

#[tokio::test]
async fn terminal_runs_are_immutable() {
    // A8 — save_checkpoint and a second finalize both refuse a terminal run.
    let h = harness().await;
    let a = seed_automation(&h, "terminal").await;
    let run = h
        .runs
        .create_run(
            &a.id,
            a.definition.clone(),
            RunTriggerContext::manual(),
            None,
        )
        .await
        .unwrap();

    h.runs
        .finalize(&run.id, TerminalStatus::Succeeded, None)
        .await
        .unwrap();

    let save_err = h
        .runs
        .save_checkpoint(&run.id, run.checkpoint.clone())
        .await
        .unwrap_err();
    assert!(
        matches!(&save_err, StoreError::TerminalRun { status, .. } if *status == RunStatus::Succeeded),
        "got {save_err:?}"
    );
    assert_eq!(
        save_err.to_string(),
        format!(
            "automation run '{}' is already terminal (succeeded)",
            run.id
        )
    );

    let refinalize_err = h
        .runs
        .finalize(&run.id, TerminalStatus::Failed, Some("late".to_string()))
        .await
        .unwrap_err();
    assert!(matches!(refinalize_err, StoreError::TerminalRun { .. }));
}

#[tokio::test]
async fn finalize_folds_error_clears_wake_at_and_stamps_finished_at() {
    let h = harness().await;
    let a = seed_automation(&h, "fails").await;
    let run = h
        .runs
        .create_run(
            &a.id,
            a.definition.clone(),
            RunTriggerContext::manual(),
            None,
        )
        .await
        .unwrap();
    let mut parked = run.checkpoint.clone();
    parked.wake_at = Some(4_102_444_800_000);
    h.runs.save_checkpoint(&run.id, parked).await.unwrap();

    let (finalized, cancelled) = h
        .runs
        .finalize(
            &run.id,
            TerminalStatus::Failed,
            Some("step 's1' failed".to_string()),
        )
        .await
        .unwrap();

    assert_eq!(finalized.status, RunStatus::Failed);
    assert_eq!(finalized.checkpoint.wake_at, None);
    assert_eq!(
        finalized.checkpoint.error.as_deref(),
        Some("step 's1' failed")
    );
    assert!(finalized.finished_at.is_some());
    assert!(cancelled.is_empty());
}

#[tokio::test]
async fn finalize_cancels_pending_interactions_in_the_same_transaction() {
    let h = harness().await;
    let a = seed_automation(&h, "cancel run").await;
    let run = h
        .runs
        .create_run(
            &a.id,
            a.definition.clone(),
            RunTriggerContext::manual(),
            None,
        )
        .await
        .unwrap();
    let interaction = h
        .interactions
        .create(&run.id, "ask#0", "Form", vec![])
        .await
        .unwrap();

    let (_, cancelled) = h
        .runs
        .finalize(&run.id, TerminalStatus::Cancelled, None)
        .await
        .unwrap();

    assert_eq!(cancelled, vec![interaction.id.clone()]);
    let after = h.interactions.get(&interaction.id).await.unwrap().unwrap();
    assert_eq!(after.status, super::InteractionStatus::Cancelled);
    assert!(after.resolved_at.is_some());
}

#[tokio::test]
async fn oversized_step_outputs_fail_loudly_and_leave_the_run_untouched() {
    let h = harness().await;
    let a = seed_automation(&h, "too big").await;
    let run = h
        .runs
        .create_run(
            &a.id,
            a.definition.clone(),
            RunTriggerContext::manual(),
            None,
        )
        .await
        .unwrap();

    let mut entry = step_entry("s1", StepStatus::Succeeded);
    let mut outputs = serde_json::Map::new();
    outputs.insert(
        "output".to_string(),
        Value::String("x".repeat(4 * 1024 * 1024)),
    );
    entry.outputs = Some(outputs);
    let checkpoint = with_step(run.checkpoint.clone(), "s1", entry);

    let err = h
        .runs
        .save_checkpoint(&run.id, checkpoint)
        .await
        .unwrap_err();
    assert!(
        matches!(err, StoreError::StepOutputsTooLarge { .. }),
        "got {err:?}"
    );
    assert!(
        err.to_string()
            .contains("write large data to a file and pass the path")
    );

    let unchanged = h.runs.get_run(&run.id).await.unwrap().unwrap();
    assert!(unchanged.checkpoint.steps.is_empty());
}
