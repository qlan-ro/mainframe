//! T2.2 — `automations` table CRUD round-trips.

use crate::domain::AutomationScope;
use crate::error::StoreError;

use super::test_support::{create_input, harness, seed_automation};

#[tokio::test]
async fn create_then_get_round_trips() {
    let h = harness().await;
    let created = seed_automation(&h, "daily standup").await;

    assert_eq!(created.name, "daily standup");
    assert_eq!(created.scope, AutomationScope::Global);
    assert!(created.enabled, "new automations start enabled");
    assert!(created.created_at > 0);
    assert_eq!(created.created_at, created.updated_at);

    let fetched = h.automations.get(&created.id).await.unwrap().unwrap();
    assert_eq!(fetched, created);
}

#[tokio::test]
async fn get_missing_returns_none() {
    let h = harness().await;
    assert!(h.automations.get("nope").await.unwrap().is_none());
}

#[tokio::test]
async fn list_returns_all_in_creation_order() {
    let h = harness().await;
    let first = seed_automation(&h, "first").await;
    let second = seed_automation(&h, "second").await;
    let names: Vec<String> = h
        .automations
        .list()
        .await
        .unwrap()
        .into_iter()
        .map(|a| a.name)
        .collect();
    assert_eq!(names, vec![first.name, second.name]);
}

#[tokio::test]
async fn update_rewrites_fields_and_touches_updated_at() {
    let h = harness().await;
    let created = seed_automation(&h, "before").await;

    let mut input = create_input("after");
    input.description = Some("now with a description".to_string());
    let updated = h.automations.update(&created.id, input).await.unwrap();

    assert_eq!(updated.name, "after");
    assert_eq!(
        updated.description.as_deref(),
        Some("now with a description")
    );
    assert!(updated.updated_at >= created.updated_at);
    assert_eq!(updated.created_at, created.created_at);
}

#[tokio::test]
async fn update_missing_is_not_found() {
    let h = harness().await;
    let err = h
        .automations
        .update("ghost", create_input("x"))
        .await
        .unwrap_err();
    assert!(matches!(err, StoreError::NotFound { .. }), "got {err:?}");
}

#[tokio::test]
async fn set_enabled_false_drops_it_from_list_enabled() {
    let h = harness().await;
    let a = seed_automation(&h, "toggle me").await;
    assert_eq!(h.automations.list_enabled().await.unwrap().len(), 1);

    let disabled = h.automations.set_enabled(&a.id, false).await.unwrap();
    assert!(!disabled.enabled);
    assert!(h.automations.list_enabled().await.unwrap().is_empty());
    // Still visible in the full list (library shows disabled automations).
    assert_eq!(h.automations.list().await.unwrap().len(), 1);
}

#[tokio::test]
async fn delete_cascades_runs_and_interactions() {
    let h = harness().await;
    let a = seed_automation(&h, "doomed").await;
    let run = h
        .runs
        .create_run(
            &a.id,
            a.definition.clone(),
            super::RunTriggerContext::manual(),
            None,
        )
        .await
        .unwrap();
    let interaction = h
        .interactions
        .create(&run.id, "ask#0", "Form", vec![])
        .await
        .unwrap();

    h.automations.delete(&a.id).await.unwrap();

    assert!(h.automations.get(&a.id).await.unwrap().is_none());
    assert!(h.runs.get_run(&run.id).await.unwrap().is_none());
    assert!(h.interactions.get(&interaction.id).await.unwrap().is_none());
}

#[tokio::test]
async fn corrupt_definition_surfaces_as_typed_error_not_panic() {
    let h = harness().await;
    let a = seed_automation(&h, "will corrupt").await;
    let id = a.id.clone();
    h.db.call(move |conn| {
        conn.execute(
            "UPDATE automations SET definition = 'not json' WHERE id = ?1",
            [&id],
        )?;
        Ok(())
    })
    .await
    .unwrap();

    let err = h.automations.get(&a.id).await.unwrap_err();
    assert!(matches!(err, StoreError::Corrupt { .. }), "got {err:?}");
}
