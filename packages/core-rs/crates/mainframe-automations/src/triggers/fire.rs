//! The one place a trigger actually starts a run (Node
//! trigger-arming.ts fireRun) — shared by the schedule sweep, the event
//! router, and chaining. Best-effort: a since-disabled or deleted
//! automation and a dedup-key loss are silent no-ops, not errors — the
//! webhook route (T9.3) bypasses this and calls the interpreter directly
//! because it must tell a duplicate (200) from a start failure (500, A7).

use std::sync::Arc;

use crate::engine::Interpreter;
use crate::error::StoreError;
use crate::store::{AutomationStore, RunRecord, RunTriggerContext};

pub struct TriggerFirer {
    automations: AutomationStore,
    interpreter: Arc<Interpreter>,
}

impl TriggerFirer {
    pub fn new(automations: AutomationStore, interpreter: Arc<Interpreter>) -> Self {
        Self {
            automations,
            interpreter,
        }
    }

    /// Starts a run for a trigger fire and spawns its advance. `Ok(None)`
    /// when the automation is gone, disabled (Decision 11: disabling disarms
    /// triggers; manual runs stay allowed elsewhere), or the dedup key lost
    /// the `uq_runs_dedup` insert race (Decision 13).
    pub async fn fire_run(
        &self,
        automation_id: &str,
        trigger: RunTriggerContext,
        dedup_key: Option<String>,
    ) -> Result<Option<RunRecord>, StoreError> {
        let Some(automation) = self.automations.get(automation_id).await? else {
            return Ok(None);
        };
        if !automation.enabled {
            return Ok(None);
        }

        let run = match self
            .interpreter
            .start_run(automation_id, automation.definition, trigger, dedup_key)
            .await
        {
            Ok(run) => run,
            Err(StoreError::DuplicateFire { .. }) => return Ok(None),
            Err(err) => return Err(err),
        };

        let interpreter = self.interpreter.clone();
        let run_id = run.id.clone();
        tokio::spawn(async move {
            if let Err(err) = interpreter.advance(&run_id).await {
                tracing::error!(run_id, error = %err, "trigger fire: advance failed");
            }
        });
        Ok(Some(run))
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T8.2), not a TS port
// confidence: high
// todos: 0
// notes: unlike Node's fireRun (fire-and-forget, swallows everything), this
//        returns unexpected store errors so callers can log with context.
