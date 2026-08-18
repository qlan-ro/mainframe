//! `wait` step end-to-end through the real facade (Part 3 Phase 1).
//!
//! The property worth proving here rather than in a lib test: a parked wait
//! lives entirely in the checkpoint, so a daemon crash mid-wait resumes on
//! schedule. The engine is dropped and rebuilt over the SAME db between the
//! park and the wake — a real crash-and-reboot, as in `restart.rs`.

use std::sync::Arc;

use serde_json::json;

use crate::harness::{
    CollectingSink, FakeAgentPort, FakeNotifier, build_actions, build_engine, wait_status,
};
use mainframe_automations::domain::AutomationCreateInput;
use mainframe_automations::store::{RunStatus, StepStatus};

/// notify → wait 5 min → notify. Inline rather than a canonical fixture: the
/// seven §12 fixtures are contract artifacts and are never re-authored.
fn definition() -> AutomationCreateInput {
    serde_json::from_value(json!({
        "name": "wait scenario",
        "scope": "global",
        "definition": {
            "triggers": [],
            "steps": [
                {"id": "before", "kind": "notify", "message": ["starting"]},
                {"id": "pause", "kind": "wait", "seconds": 300},
                {"id": "after", "kind": "notify", "message": ["resumed"]}
            ]
        }
    }))
    .unwrap()
}

#[tokio::test]
async fn a_parked_wait_survives_a_restart_and_resumes_when_due() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("automations.db");
    let creds = dir.path().join("automation-credentials.json");
    let actions = build_actions();

    // ── boot 1: run until the wait parks ────────────────────────────────────
    let engine = build_engine(
        &db,
        &creds,
        Arc::new(FakeAgentPort::default()),
        Arc::new(FakeNotifier::default()),
        Arc::new(CollectingSink::default()),
        &actions,
    )
    .await;
    let created = engine.create(definition()).await.unwrap();
    engine.set_enabled(&created.id, false).await.unwrap();
    let run_id = engine.run_manually(&created.id).await.unwrap().id;

    let parked = wait_status(&engine, &run_id, RunStatus::Waiting).await;
    assert_eq!(
        parked.checkpoint.steps["before"].status,
        StepStatus::Succeeded
    );
    assert_eq!(parked.checkpoint.steps["pause"].status, StepStatus::Waiting);
    assert!(
        !parked.checkpoint.steps.contains_key("after"),
        "the step after the wait must not have run yet"
    );
    let wake_at = parked.checkpoint.wake_at.expect("the wait armed a wakeAt");

    // ── crash ───────────────────────────────────────────────────────────────
    drop(engine);

    // ── boot 2: same db, fresh engine ───────────────────────────────────────
    let engine = build_engine(
        &db,
        &creds,
        Arc::new(FakeAgentPort::default()),
        Arc::new(FakeNotifier::default()),
        Arc::new(CollectingSink::default()),
        &actions,
    )
    .await;
    let rebooted = engine.get_run(&run_id).await.unwrap().unwrap();
    assert_eq!(
        rebooted.checkpoint.wake_at,
        Some(wake_at),
        "the wakeAt must survive the restart unchanged — a re-armed wait would slip"
    );

    engine.sweep_due(wake_at).await.unwrap();

    let finished = wait_status(&engine, &run_id, RunStatus::Succeeded).await;
    assert_eq!(
        finished.checkpoint.steps["pause"].status,
        StepStatus::Succeeded
    );
    assert_eq!(
        finished.checkpoint.steps["after"].status,
        StepStatus::Succeeded
    );
    assert_eq!(finished.checkpoint.wake_at, None);
}
