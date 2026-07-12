//! Sweep-driven schedule triggers (T8.2). No timers-per-schedule and no
//! stored next-fire state (locked decision: derived, not stored): every 30 s
//! the sweep recomputes each enabled schedule's latest occurrence ≤ now and
//! offers it to the runs table — the `uq_runs_dedup` unique index, keyed
//! `<triggerId>|<scheduledFor>`, is what makes re-offers of an already-fired
//! slot lose deterministically. Survives restarts and laptop sleep with
//! zero extra tables.

use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, FixedOffset};

use crate::domain::{OnMissed, ScheduleTrigger, Trigger};
use crate::ports::Clock;
use crate::scheduler::{latest_occurrence_at_or_before, scheduled_for_string};
use crate::store::{AutomationRecord, AutomationStore, RunTriggerContext, RunTriggerKind};

use super::fire::TriggerFirer;

/// A fire more than this late is a missed slot handled by `onMissed`
/// (Node scheduler.ts: stale is strictly greater than the window; the
/// interval cap it also applies never binds for hourly-or-slower schedules).
const FRESH_WINDOW_MS: i64 = 5 * 60_000;

pub const SWEEP_INTERVAL: Duration = Duration::from_secs(30);

pub struct ScheduleSweeper {
    automations: AutomationStore,
    firer: Arc<TriggerFirer>,
}

impl ScheduleSweeper {
    pub fn new(automations: AutomationStore, firer: Arc<TriggerFirer>) -> Self {
        Self { automations, firer }
    }

    /// Offers every enabled schedule's current slot. All failures log and
    /// continue — one broken automation must not starve the rest.
    pub async fn sweep(&self, now: DateTime<FixedOffset>) {
        let enabled = match self.automations.list_enabled().await {
            Ok(enabled) => enabled,
            Err(err) => {
                tracing::error!(error = %err, "schedule sweep: listing automations failed");
                return;
            }
        };
        for automation in &enabled {
            for trigger in &automation.definition.triggers {
                if let Trigger::Schedule(schedule) = trigger {
                    self.sweep_trigger(automation, schedule, now).await;
                }
            }
        }
    }

    async fn sweep_trigger(
        &self,
        automation: &AutomationRecord,
        trigger: &ScheduleTrigger,
        now: DateTime<FixedOffset>,
    ) {
        let latest = match latest_occurrence_at_or_before(&trigger.schedule, &now) {
            Ok(Some(latest)) => latest,
            Ok(None) => return,
            Err(err) => {
                tracing::warn!(
                    automation_id = automation.id,
                    trigger_id = trigger.id,
                    error = %err,
                    "schedule sweep: occurrence computation failed"
                );
                return;
            }
        };

        let late_ms = now.signed_duration_since(latest).num_milliseconds();
        let stale = late_ms > FRESH_WINDOW_MS;
        if stale && trigger.on_missed == OnMissed::Skip {
            return;
        }
        // Fresh, or a stale slot under run_once: fire the latest slot only —
        // one make-up regardless of how many were missed.

        let scheduled_for = scheduled_for_string(&latest);
        let dedup_key = format!("{}|{}", trigger.id, scheduled_for);
        let context = RunTriggerContext {
            kind: RunTriggerKind::Schedule,
            trigger_id: Some(trigger.id.clone()),
            scheduled_for: Some(scheduled_for),
            payload: None,
        };
        if let Err(err) = self
            .firer
            .fire_run(&automation.id, context, Some(dedup_key))
            .await
        {
            tracing::error!(
                automation_id = automation.id,
                trigger_id = trigger.id,
                error = %err,
                "schedule sweep: fire failed"
            );
        }
    }

    /// The 30 s driver the facade arms at boot (T10.1). `Delay` tick
    /// behavior: after a laptop sleep the missed ticks collapse into one
    /// sweep — the dedup index makes that sweep fire each slot at most once.
    pub fn spawn(self: Arc<Self>, clock: Arc<dyn Clock>) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(SWEEP_INTERVAL);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                interval.tick().await;
                self.sweep(clock.now()).await;
            }
        })
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T8.2), not a TS port
// confidence: high
// todos: 0
// notes: replaces Node's CronScheduler + trigger_state rows with derived
//        latest-occurrence math over the runs table's unique index.
