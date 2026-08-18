//! The run half of the facade: manual starts, listing, and cancellation.
//! Split out of `service.rs` for the file-size cap; the methods stay inherent
//! so the route layer sees one engine surface.

use crate::error::StoreError;
use crate::ports::{RunSummary, to_run_summary};
use crate::store::{RunRecord, RunTriggerContext};

use super::{AutomationsEngine, EngineError};

/// The runs page every list route serves (Node parity).
pub(super) const RUNS_PAGE: u32 = 50;

impl AutomationsEngine {
    pub async fn run_manually(&self, id: &str) -> Result<RunRecord, EngineError> {
        let record = self.automations.get(id).await?.ok_or_else(|| {
            EngineError::Store(StoreError::NotFound {
                kind: "automation",
                id: id.to_string(),
            })
        })?;
        let run = self
            .interpreter
            .start_run(id, record.definition, RunTriggerContext::manual(), None)
            .await?;
        let interpreter = self.interpreter.clone();
        let run_id = run.id.clone();
        tokio::spawn(async move {
            if let Err(err) = interpreter.advance(&run_id).await {
                tracing::error!(run_id, error = %err, "manual run: advance failed");
            }
        });
        Ok(run)
    }

    /// Resolve every live run whose `wakeAt` has passed — agent deadlines fail,
    /// `wait` steps resume. `start()` arms this on a 30 s tick; it is public so
    /// a caller with its own clock (the conformance suite) can drive it
    /// deterministically instead of sleeping.
    pub async fn sweep_due(&self, now: i64) -> Result<(), EngineError> {
        self.interpreter.sweep_due(now).await?;
        Ok(())
    }

    pub async fn list_runs(&self, automation_id: &str) -> Result<Vec<RunSummary>, EngineError> {
        let runs = self.runs.list_runs(automation_id, RUNS_PAGE).await?;
        Ok(runs.iter().map(to_run_summary).collect())
    }

    pub async fn get_run(&self, run_id: &str) -> Result<Option<RunRecord>, EngineError> {
        Ok(self.runs.get_run(run_id).await?)
    }

    pub async fn cancel_run(&self, run_id: &str) -> Result<(), EngineError> {
        if self.runs.get_run(run_id).await?.is_none() {
            return Err(EngineError::Store(StoreError::NotFound {
                kind: "automation run",
                id: run_id.to_string(),
            }));
        }
        Ok(self.interpreter.cancel_run(run_id).await?)
    }
}

// PORT STATUS: packages/core/src/automations/service.ts (runs surface)
// confidence: high
// todos: 0
// notes: run_manually returns as soon as the run row exists; advance runs on a
//        detached task so the route can answer 202.
