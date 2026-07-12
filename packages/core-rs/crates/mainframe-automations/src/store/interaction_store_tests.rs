//! T2.2 — interaction store: pending lifecycle and the one-transaction
//! `resolve_interaction` (contract §3: a crash cannot strand an `answered`
//! interaction against a still-`waiting` step).

use serde_json::{Value, json};

use crate::domain::{AutomationFormField, FormFieldType};
use crate::error::StoreError;

use super::test_support::{StoreHarness, harness, seed_automation, step_entry, with_step};
use super::{InteractionStatus, RunRecord, RunStatus, RunTriggerContext, StepStatus};

fn mood_field() -> AutomationFormField {
    AutomationFormField {
        key: "mood".to_string(),
        field_type: FormFieldType::Text,
        label: Some("Mood".to_string()),
        options: None,
        required: true,
        show_when: None,
    }
}

async fn parked_run(h: &StoreHarness) -> RunRecord {
    let a = seed_automation(h, "with form").await;
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
    h.runs.save_checkpoint(&run.id, checkpoint).await.unwrap()
}

fn answers() -> serde_json::Map<String, Value> {
    let mut map = serde_json::Map::new();
    map.insert("mood".to_string(), json!("great"));
    map
}

#[tokio::test]
async fn create_get_and_pending_queries_round_trip() {
    let h = harness().await;
    let run = parked_run(&h).await;

    let created = h
        .interactions
        .create(&run.id, "ask", "Daily check-in", vec![mood_field()])
        .await
        .unwrap();
    assert_eq!(created.status, InteractionStatus::Pending);
    assert_eq!(created.fields, vec![mood_field()]);
    assert_eq!(created.resolved_at, None);

    let fetched = h.interactions.get(&created.id).await.unwrap().unwrap();
    assert_eq!(fetched, created);

    let pending = h.interactions.list_pending().await.unwrap();
    assert_eq!(pending, vec![created.clone()]);

    let for_step = h
        .interactions
        .find_pending_for_step(&run.id, "ask")
        .await
        .unwrap();
    assert_eq!(for_step, Some(created));
    assert_eq!(
        h.interactions
            .find_pending_for_step(&run.id, "other")
            .await
            .unwrap(),
        None
    );
}

#[tokio::test]
async fn resolve_claims_and_writes_answers_in_one_transaction() {
    let h = harness().await;
    let run = parked_run(&h).await;
    assert_eq!(run.status, RunStatus::Waiting);
    let interaction = h
        .interactions
        .create(&run.id, "ask", "Daily check-in", vec![mood_field()])
        .await
        .unwrap();

    let resolved = h
        .interactions
        .resolve_interaction(&interaction.id, answers())
        .await
        .unwrap();
    assert!(resolved);

    let after = h.interactions.get(&interaction.id).await.unwrap().unwrap();
    assert_eq!(after.status, InteractionStatus::Answered);
    assert!(after.resolved_at.is_some());

    let run_after = h.runs.get_run(&run.id).await.unwrap().unwrap();
    let entry = run_after.checkpoint.steps.get("ask").unwrap();
    assert_eq!(entry.status, StepStatus::Succeeded);
    assert_eq!(
        entry.outputs.as_ref().unwrap().get("mood"),
        Some(&json!("great"))
    );
    assert_eq!(entry.error, None);
    assert!(entry.finished_at.is_some());
    // The answered step no longer waits, so the run derives back to running.
    assert_eq!(run_after.status, RunStatus::Running);
}

#[tokio::test]
async fn second_resolve_returns_false() {
    let h = harness().await;
    let run = parked_run(&h).await;
    let interaction = h
        .interactions
        .create(&run.id, "ask", "Form", vec![])
        .await
        .unwrap();

    assert!(
        h.interactions
            .resolve_interaction(&interaction.id, answers())
            .await
            .unwrap()
    );
    assert!(
        !h.interactions
            .resolve_interaction(&interaction.id, answers())
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn resolve_on_a_cancelled_interaction_returns_false() {
    let h = harness().await;
    let run = parked_run(&h).await;
    let interaction = h
        .interactions
        .create(&run.id, "ask", "Form", vec![])
        .await
        .unwrap();
    h.runs
        .finalize(&run.id, super::TerminalStatus::Cancelled, None)
        .await
        .unwrap();

    assert!(
        !h.interactions
            .resolve_interaction(&interaction.id, answers())
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn resolve_missing_interaction_is_not_found() {
    let h = harness().await;
    let err = h
        .interactions
        .resolve_interaction("ghost", answers())
        .await
        .unwrap_err();
    assert!(matches!(err, StoreError::NotFound { .. }), "got {err:?}");
}

#[tokio::test]
async fn resolve_failure_rolls_back_the_claim() {
    // The interaction points at a stepRef the checkpoint does not carry —
    // the patch fails, and the pending claim must roll back with it.
    let h = harness().await;
    let run = parked_run(&h).await;
    let interaction = h
        .interactions
        .create(&run.id, "missing-step", "Form", vec![])
        .await
        .unwrap();

    let err = h
        .interactions
        .resolve_interaction(&interaction.id, answers())
        .await
        .unwrap_err();
    assert_eq!(
        err.to_string(),
        "ask_me step 'missing-step' not found in checkpoint"
    );

    let after = h.interactions.get(&interaction.id).await.unwrap().unwrap();
    assert_eq!(
        after.status,
        InteractionStatus::Pending,
        "claim must roll back"
    );
    assert_eq!(after.resolved_at, None);
}

#[tokio::test]
async fn malformed_fields_json_defaults_to_empty_list() {
    let h = harness().await;
    let run = parked_run(&h).await;
    let interaction = h
        .interactions
        .create(&run.id, "ask", "Form", vec![mood_field()])
        .await
        .unwrap();
    let id = interaction.id.clone();
    h.db.call(move |conn| {
        conn.execute(
            "UPDATE automation_interactions SET fields = 'not json' WHERE id = ?1",
            [&id],
        )?;
        Ok(())
    })
    .await
    .unwrap();

    let fetched = h.interactions.get(&interaction.id).await.unwrap().unwrap();
    assert!(fetched.fields.is_empty());
}
