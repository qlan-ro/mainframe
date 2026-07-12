//! `AutomationsEngine::start()` — boot reconcile + trigger arming (T10.1,
//! Node service.start). Reconcile mirrors v1's replay resume: every live run
//! re-attaches its durable agent watch, then re-advances (a `running` run
//! finishes its tail, a `waiting` run re-parks). Then the 30 s schedule sweep
//! and the event-source subscription come online. Idempotent by a one-shot
//! latch — a second call is a typed error, never a double-armed sweep.

use std::sync::atomic::Ordering;

use crate::error::StoreError;
use crate::triggers::spawn_event_loop;

use super::AutomationsEngine;

#[derive(Debug, thiserror::Error)]
pub enum StartError {
    /// `start()` was already called — arming twice would double-schedule.
    #[error("automations engine already started")]
    AlreadyStarted,
    /// The boot scan (`list_live_runs`) could not read the runs table.
    #[error(transparent)]
    Store(#[from] StoreError),
}

impl AutomationsEngine {
    /// Boot the engine: reconcile in-flight runs, then arm the triggers.
    /// Safe to call once; the reconcile is bounded (each live run advances to
    /// its next park or terminal), so awaiting it before the daemon listens
    /// matches Node's construction-time resume.
    pub async fn start(&self) -> Result<(), StartError> {
        if self.started.swap(true, Ordering::SeqCst) {
            return Err(StartError::AlreadyStarted);
        }

        // Reconcile: re-attach every durable agent watch FIRST (so the
        // re-advance below sees the wait already registered and re-parks
        // instead of opening a second chat), then re-advance each run.
        let live = self.runs.list_live_runs().await?;
        for run in &live {
            self.agent_verb.resume_run_watches(run);
        }
        for run in &live {
            if let Err(err) = self.interpreter.advance(&run.id).await {
                // One stuck run must not abort boot for the rest.
                tracing::error!(run_id = run.id, error = %err, "automations start: reconcile advance failed");
            }
        }

        // Arm the derived-state schedule sweep and the event-trigger loop.
        // Their JoinHandles live in `tasks` so `stop()` aborts them.
        let mut tasks = self.tasks.lock().unwrap_or_else(|e| e.into_inner());
        tasks.push(self.sweeper.clone().spawn(self.clock.clone()));
        if let Some(source) = &self.event_source {
            tasks.push(spawn_event_loop(self.router.clone(), source.clone()));
        }
        Ok(())
    }
}

// PORT STATUS: packages/core/src/automations/service.ts start()/reconcile
// confidence: high
// todos: 0
// notes: reconcile awaits each advance (bounded — to next park/terminal), so a
//        dropped-then-rebuilt engine over the same DB resumes deterministically
//        (T10.3). Sweep/event loop are the only long-lived tasks stop() drains.
