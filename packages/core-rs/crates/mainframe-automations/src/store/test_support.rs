//! Shared fixtures for the store test modules (test-only).

use tempfile::TempDir;

use crate::domain::{AutomationCreateInput, AutomationDefinition, AutomationScope};

use super::{
    AutomationCheckpoint, AutomationDb, AutomationRecord, AutomationStore, CheckpointStep,
    InteractionStore, RunStore, StepStatus,
};

pub(crate) struct StoreHarness {
    // Held for its Drop: deletes the temp dir at the end of the test.
    pub _dir: TempDir,
    pub db: AutomationDb,
    pub automations: AutomationStore,
    pub runs: RunStore,
    pub interactions: InteractionStore,
}

pub(crate) async fn harness() -> StoreHarness {
    let dir = TempDir::new().unwrap();
    let db = AutomationDb::open(dir.path().join("automations.db"))
        .await
        .unwrap();
    StoreHarness {
        _dir: dir,
        automations: AutomationStore::new(db.clone()),
        runs: RunStore::new(db.clone()),
        interactions: InteractionStore::new(db.clone()),
        db,
    }
}

pub(crate) fn create_input(name: &str) -> AutomationCreateInput {
    AutomationCreateInput {
        name: name.to_string(),
        description: None,
        scope: AutomationScope::Global,
        project_id: None,
        definition: AutomationDefinition {
            triggers: vec![],
            steps: vec![],
        },
    }
}

pub(crate) async fn seed_automation(h: &StoreHarness, name: &str) -> AutomationRecord {
    h.automations.create(create_input(name)).await.unwrap()
}

pub(crate) fn step_entry(step_id: &str, status: StepStatus) -> CheckpointStep {
    CheckpointStep {
        step_id: step_id.to_string(),
        kind: "notify".to_string(),
        status,
        outputs: None,
        error: None,
        started_at: Some(1),
        finished_at: None,
        chat_id: None,
        interaction_id: None,
    }
}

pub(crate) fn with_step(
    mut checkpoint: AutomationCheckpoint,
    step_ref: &str,
    entry: CheckpointStep,
) -> AutomationCheckpoint {
    checkpoint.steps.insert(step_ref.to_string(), entry);
    checkpoint
}
