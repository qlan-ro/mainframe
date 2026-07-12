//! T2.2 — run store: checkpoint persistence, the dedup insert race,
//! resumable listing, and the checkpoint wire shape. Status derivation and
//! terminal-immutability tests live in run_status_tests.rs.

use serde_json::json;

use crate::error::StoreError;

use super::test_support::{harness, seed_automation, step_entry};
use super::{
    AutomationCheckpoint, RunStatus, RunTriggerContext, RunTriggerKind, StepStatus, TerminalStatus,
};

fn schedule_trigger() -> RunTriggerContext {
    RunTriggerContext {
        kind: RunTriggerKind::Schedule,
        trigger_id: Some("t1".to_string()),
        scheduled_for: Some("2026-07-12T09:00:00".to_string()),
        payload: None,
    }
}

#[tokio::test]
async fn create_run_freezes_definition_and_trigger_in_the_checkpoint() {
    let h = harness().await;
    let a = seed_automation(&h, "scheduled").await;

    let run = h
        .runs
        .create_run(
            &a.id,
            a.definition.clone(),
            schedule_trigger(),
            Some("t1|2026-07-12T09:00:00".to_string()),
        )
        .await
        .unwrap();

    assert_eq!(run.automation_id, a.id);
    assert_eq!(run.status, RunStatus::Running);
    assert_eq!(run.checkpoint.definition, a.definition);
    assert_eq!(run.checkpoint.trigger, schedule_trigger());
    assert!(run.checkpoint.steps.is_empty());
    assert_eq!(run.checkpoint.wake_at, None);
    assert_eq!(run.checkpoint.error, None);
    assert!(run.started_at > 0);
    assert_eq!(run.finished_at, None);

    let fetched = h.runs.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(fetched, run);
}

#[tokio::test]
async fn duplicate_dedup_key_loses_the_insert_race() {
    let h = harness().await;
    let a = seed_automation(&h, "dedup").await;
    let key = Some("t1|2026-07-12T09:00:00".to_string());

    h.runs
        .create_run(&a.id, a.definition.clone(), schedule_trigger(), key.clone())
        .await
        .unwrap();
    let err = h
        .runs
        .create_run(&a.id, a.definition.clone(), schedule_trigger(), key)
        .await
        .unwrap_err();
    assert!(
        matches!(err, StoreError::DuplicateFire { .. }),
        "got {err:?}"
    );
}

#[tokio::test]
async fn manual_runs_never_collide() {
    let h = harness().await;
    let a = seed_automation(&h, "manual twice").await;
    for _ in 0..2 {
        h.runs
            .create_run(
                &a.id,
                a.definition.clone(),
                RunTriggerContext::manual(),
                None,
            )
            .await
            .unwrap();
    }
    assert_eq!(h.runs.list_runs(&a.id, 50).await.unwrap().len(), 2);
}

#[tokio::test]
async fn list_live_runs_returns_running_and_waiting_only() {
    let h = harness().await;
    let a = seed_automation(&h, "live").await;
    let mk = |key: &str| {
        let definition = a.definition.clone();
        let id = a.id.clone();
        let key = Some(format!("t|{key}"));
        let runs = &h.runs;
        async move {
            runs.create_run(&id, definition, schedule_trigger(), key)
                .await
                .unwrap()
        }
    };
    let running = mk("1").await;
    let waiting = mk("2").await;
    let done = mk("3").await;

    let mut parked = waiting.checkpoint.clone();
    parked.wake_at = Some(4_102_444_800_000);
    h.runs.save_checkpoint(&waiting.id, parked).await.unwrap();
    h.runs
        .finalize(&done.id, TerminalStatus::Succeeded, None)
        .await
        .unwrap();

    let mut live: Vec<String> = h
        .runs
        .list_live_runs()
        .await
        .unwrap()
        .into_iter()
        .map(|r| r.id)
        .collect();
    live.sort();
    let mut expected = vec![running.id, waiting.id];
    expected.sort();
    assert_eq!(live, expected);
}

#[tokio::test]
async fn corrupt_checkpoint_row_is_finalized_failed_and_excluded_from_live() {
    let h = harness().await;
    let a = seed_automation(&h, "corrupt").await;
    let id = a.id.clone();
    h.db
        .call(move |conn| {
            conn.execute(
                "INSERT INTO automation_runs (id, automation_id, status, trigger_dedup_key, checkpoint, started_at)
                 VALUES ('bad-run', ?1, 'running', NULL, 'not json', 1)",
                [&id],
            )?;
            Ok(())
        })
        .await
        .unwrap();

    assert!(h.runs.list_live_runs().await.unwrap().is_empty());

    let failed = h.runs.get_run("bad-run").await.unwrap().unwrap();
    assert_eq!(failed.status, RunStatus::Failed);
    assert_eq!(
        failed.checkpoint.error.as_deref(),
        Some("corrupt checkpoint")
    );
    assert!(failed.finished_at.is_some());
}

#[tokio::test]
async fn checkpoint_serde_matches_the_node_wire_shape() {
    // Explicit nulls where Node types `T | null`; omitted TS-optionals.
    let entry = step_entry("s1", StepStatus::Succeeded);
    let value = serde_json::to_value(&entry).unwrap();
    assert_eq!(
        value,
        json!({
            "stepId": "s1",
            "kind": "notify",
            "status": "succeeded",
            "outputs": null,
            "error": null,
            "startedAt": 1,
            "finishedAt": null
        })
    );

    let checkpoint = AutomationCheckpoint::new(
        crate::domain::AutomationDefinition {
            triggers: vec![],
            steps: vec![],
        },
        RunTriggerContext::manual(),
    );
    let value = serde_json::to_value(&checkpoint).unwrap();
    assert_eq!(
        value,
        json!({
            "definition": {"triggers": [], "steps": []},
            "trigger": {"kind": "manual"},
            "steps": {},
            "wakeAt": null,
            "error": null
        })
    );
}
