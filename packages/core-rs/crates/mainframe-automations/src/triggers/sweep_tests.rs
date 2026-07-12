//! T8.2 — the 30 s sweep with derived scheduler state: fresh fires carry
//! `trigger:{kind:schedule,triggerId,scheduledFor}` + the dedup key; a
//! duplicate fire loses the `uq_runs_dedup` insert race silently; after a
//! 3-day sleep `run_once` fires exactly one make-up and `skip` none;
//! disabled automations never fire.

use std::sync::Arc;

use chrono::{DateTime, FixedOffset};
use tempfile::TempDir;

use crate::domain::{
    AutomationCreateInput, AutomationDefinition, AutomationScope, DailySchedule, OnMissed,
    SchedulePattern, ScheduleTrigger, Trigger,
};
use crate::engine::test_support::{CollectingSink, FakeClock, FakePorts};
use crate::engine::{Interpreter, InterpreterDeps};
use crate::store::{AutomationDb, AutomationStore, RunStore, RunTriggerKind};

use super::fire::TriggerFirer;
use super::sweep::ScheduleSweeper;

struct SweepHarness {
    _dir: TempDir,
    automations: AutomationStore,
    runs: RunStore,
    sweeper: ScheduleSweeper,
}

async fn harness() -> SweepHarness {
    let dir = tempfile::tempdir().unwrap();
    let db = AutomationDb::open(dir.path().join("automations.db"))
        .await
        .unwrap();
    let automations = AutomationStore::new(db.clone());
    let runs = RunStore::new(db);
    let interpreter = Arc::new(Interpreter::new(InterpreterDeps {
        store: runs.clone(),
        ports: Arc::new(FakePorts::default()),
        events: Arc::new(CollectingSink::default()),
        clock: Arc::new(FakeClock),
        is_idempotent: None,
        agent_waits: None,
        on_finalized: None,
    }));
    let firer = Arc::new(TriggerFirer::new(automations.clone(), interpreter));
    let sweeper = ScheduleSweeper::new(automations.clone(), firer);
    SweepHarness {
        _dir: dir,
        automations,
        runs,
        sweeper,
    }
}

fn daily_definition(trigger_id: &str, at: &str, on_missed: OnMissed) -> AutomationDefinition {
    AutomationDefinition {
        triggers: vec![Trigger::Schedule(ScheduleTrigger {
            id: trigger_id.to_string(),
            schedule: SchedulePattern::Daily(DailySchedule { at: at.to_string() }),
            on_missed,
        })],
        steps: vec![],
    }
}

async fn create(harness: &SweepHarness, name: &str, definition: AutomationDefinition) -> String {
    harness
        .automations
        .create(AutomationCreateInput {
            name: name.to_string(),
            description: None,
            scope: AutomationScope::Global,
            project_id: None,
            definition,
        })
        .await
        .unwrap()
        .id
}

fn at(rfc3339: &str) -> DateTime<FixedOffset> {
    DateTime::parse_from_rfc3339(rfc3339).unwrap()
}

#[tokio::test]
async fn fresh_fire_creates_a_run_with_schedule_trigger_and_dedup_key() {
    let h = harness().await;
    let id = create(
        &h,
        "health log",
        daily_definition("t1", "21:00", OnMissed::Skip),
    )
    .await;

    // 2 minutes past the slot — fresh.
    h.sweeper.sweep(at("2026-07-12T21:02:00+02:00")).await;

    let runs = h.runs.list_runs(&id, 10).await.unwrap();
    assert_eq!(runs.len(), 1);
    let trigger = &runs[0].checkpoint.trigger;
    assert_eq!(trigger.kind, RunTriggerKind::Schedule);
    assert_eq!(trigger.trigger_id.as_deref(), Some("t1"));
    assert_eq!(
        trigger.scheduled_for.as_deref(),
        Some("2026-07-12T21:00:00"),
        "scheduledFor is the naive-local slot that came due"
    );
}

#[tokio::test]
async fn duplicate_fire_loses_the_insert_race_silently() {
    let h = harness().await;
    let id = create(&h, "a", daily_definition("t1", "21:00", OnMissed::Skip)).await;

    h.sweeper.sweep(at("2026-07-12T21:01:00+02:00")).await;
    // Same slot again (a later sweep in the fresh window, or a racing
    // sweeper): the dedup key is identical, the insert loses, no double run.
    h.sweeper.sweep(at("2026-07-12T21:03:30+02:00")).await;

    assert_eq!(h.runs.list_runs(&id, 10).await.unwrap().len(), 1);
}

#[tokio::test]
async fn run_once_fires_exactly_one_make_up_after_a_sleep() {
    let h = harness().await;
    let id = create(&h, "a", daily_definition("t1", "21:00", OnMissed::RunOnce)).await;

    // Day 0: fresh fire.
    h.sweeper.sweep(at("2026-07-12T21:00:30+02:00")).await;
    // Laptop slept 3 days; the sweep wakes at 23:00 — 2h past today's slot,
    // with 3 whole missed days in between.
    h.sweeper.sweep(at("2026-07-15T23:00:00+02:00")).await;

    let runs = h.runs.list_runs(&id, 10).await.unwrap();
    assert_eq!(runs.len(), 2, "one make-up, not one per missed day");
    let mut slots: Vec<_> = runs
        .iter()
        .map(|r| r.checkpoint.trigger.scheduled_for.clone().unwrap())
        .collect();
    slots.sort();
    assert_eq!(
        slots,
        vec!["2026-07-12T21:00:00", "2026-07-15T21:00:00"],
        "the make-up is the latest slot only"
    );
}

#[tokio::test]
async fn skip_fires_nothing_after_a_sleep() {
    let h = harness().await;
    let id = create(&h, "a", daily_definition("t1", "21:00", OnMissed::Skip)).await;

    h.sweeper.sweep(at("2026-07-12T21:00:30+02:00")).await;
    h.sweeper.sweep(at("2026-07-15T23:00:00+02:00")).await;

    let runs = h.runs.list_runs(&id, 10).await.unwrap();
    assert_eq!(runs.len(), 1, "the stale slot is skipped");
}

#[tokio::test]
async fn disabled_automations_never_fire() {
    let h = harness().await;
    let id = create(&h, "a", daily_definition("t1", "21:00", OnMissed::RunOnce)).await;
    h.automations.set_enabled(&id, false).await.unwrap();

    h.sweeper.sweep(at("2026-07-12T21:01:00+02:00")).await;

    assert!(h.runs.list_runs(&id, 10).await.unwrap().is_empty());
}

#[tokio::test]
async fn a_deleted_automation_mid_sweep_is_a_silent_no_op() {
    let h = harness().await;
    let id = create(&h, "a", daily_definition("t1", "21:00", OnMissed::Skip)).await;
    // fire_run re-checks the row: deleting between list and fire is fine.
    h.automations.delete(&id).await.unwrap();
    h.sweeper.sweep(at("2026-07-12T21:01:00+02:00")).await;
    assert!(h.runs.list_runs(&id, 10).await.unwrap().is_empty());
}

#[tokio::test]
async fn exactly_five_minutes_late_is_still_fresh_beyond_is_stale() {
    let h = harness().await;
    let id = create(&h, "a", daily_definition("t1", "21:00", OnMissed::Skip)).await;

    // 5:00 late — not yet stale (Node: stale is strictly > the window).
    h.sweeper.sweep(at("2026-07-12T21:05:00+02:00")).await;
    assert_eq!(h.runs.list_runs(&id, 10).await.unwrap().len(), 1);

    let id2 = create(&h, "b", daily_definition("t2", "21:00", OnMissed::Skip)).await;
    // 5:01 late — stale, skip drops it.
    h.sweeper.sweep(at("2026-07-12T21:05:01+02:00")).await;
    assert!(h.runs.list_runs(&id2, 10).await.unwrap().is_empty());
}
