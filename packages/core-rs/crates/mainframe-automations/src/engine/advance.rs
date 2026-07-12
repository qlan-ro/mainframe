//! Serialized per-run advance loop (Node engine/interpreter.ts, contract §2
//! Decision 12 + A8). `advance()` is safe to call repeatedly (wake, boot
//! reconcile, retry); concurrent calls for one run serialize on a per-run
//! lock so a step never executes twice from a race.

use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex, MutexGuard};

use tokio::sync::{Mutex as TokioMutex, watch};

use crate::domain::{AutomationDefinition, RunActionStep, Step, find_step_by_id};
use crate::error::StoreError;
use crate::ports::{AutomationEvent, Clock, EventSink, to_run_summary};
use crate::store::{RunRecord, RunStore, RunTriggerContext, StepStatus, TerminalStatus};

use super::checkpoint::fail_step_entry;
use super::walk::{WalkCtx, walk_steps};
use super::{BoxFuture, RunAdvancer, VerbPorts, WalkResult};

const RESTART_MID_ACTION_ERROR: &str = "engine restarted mid-action; effect unknown";

/// Narrow view of the (T4.3) agent-wait registry — cancel only needs to purge
/// a run's registrations so a chat that finishes later cannot resurrect it.
pub trait AgentWaitRegistry: Send + Sync {
    fn clear_for_run(&self, run_id: &str);
}

/// Decision 12 restart policy hook: true only for run_action steps safe to
/// blindly re-invoke after an unknown-effect restart.
pub type IdempotencyHook = Arc<dyn Fn(&RunActionStep) -> bool + Send + Sync>;

pub struct InterpreterDeps {
    pub store: RunStore,
    pub ports: Arc<dyn VerbPorts>,
    pub events: Arc<dyn EventSink>,
    pub clock: Arc<dyn Clock>,
    /// Default (`None`): fail loudly. ask_agent is never restart-safe
    /// regardless of this hook.
    pub is_idempotent: Option<IdempotencyHook>,
    pub agent_waits: Option<Arc<dyn AgentWaitRegistry>>,
}

pub struct Interpreter {
    pub(crate) deps: InterpreterDeps,
    in_flight: StdMutex<HashMap<String, Arc<TokioMutex<()>>>>,
    cancels: StdMutex<HashMap<String, watch::Sender<bool>>>,
}

impl Interpreter {
    pub fn new(deps: InterpreterDeps) -> Self {
        Self {
            deps,
            in_flight: StdMutex::new(HashMap::new()),
            cancels: StdMutex::new(HashMap::new()),
        }
    }

    pub async fn start_run(
        &self,
        automation_id: &str,
        definition: AutomationDefinition,
        trigger: RunTriggerContext,
        dedup_key: Option<String>,
    ) -> Result<RunRecord, StoreError> {
        let run = self
            .deps
            .store
            .create_run(automation_id, definition, trigger, dedup_key)
            .await?;
        self.emit(&run);
        Ok(run)
    }

    /// Serialized per-run entry point.
    pub async fn advance(&self, run_id: &str) -> Result<(), StoreError> {
        let lock = self.lease(run_id);
        let result = {
            let _guard = lock.lock().await;
            self.advance_inner(run_id).await
        };
        self.release(run_id, lock);
        result
    }

    /// A8 — cancellation is authoritative: abort the in-flight walk, then
    /// finalize `cancelled` + cancel pending interactions in ONE store
    /// transaction (`RunStore::finalize`), then purge agent-wait
    /// registrations so a chat that finishes later finds nothing to wake.
    /// A run that is already terminal is a silent no-op.
    pub async fn cancel_run(&self, run_id: &str) -> Result<(), StoreError> {
        if let Some(tx) = lock_map(&self.cancels).get(run_id) {
            let _ = tx.send(true);
        }
        match self
            .deps
            .store
            .finalize(run_id, TerminalStatus::Cancelled, None)
            .await
        {
            Ok((record, _cancelled_interactions)) => {
                if let Some(waits) = &self.deps.agent_waits {
                    waits.clear_for_run(run_id);
                }
                self.emit(&record);
                Ok(())
            }
            Err(StoreError::TerminalRun { .. }) => Ok(()),
            Err(err) => Err(err),
        }
    }

    async fn advance_inner(&self, run_id: &str) -> Result<(), StoreError> {
        let Some(run) = self.deps.store.get_run(run_id).await? else {
            return Ok(());
        };
        if run.status.is_terminal() {
            return Ok(());
        }

        if let Some(fatal) = self.resolve_stale_running(&run).await? {
            return self
                .finalize_and_emit(run_id, TerminalStatus::Failed, Some(fatal))
                .await;
        }
        let Some(run) = self.deps.store.get_run(run_id).await? else {
            return Ok(());
        };

        let mut cancel_rx = self.register_cancel(run_id);
        let walk_outcome = {
            let ctx = WalkCtx {
                run_id: &run.id,
                store: &self.deps.store,
                ports: self.deps.ports.as_ref(),
                clock: self.deps.clock.clone(),
                events: self.deps.events.as_ref(),
            };
            let walk = walk_steps(
                &run.checkpoint.definition.steps,
                run.checkpoint.clone(),
                &ctx,
            );
            tokio::pin!(walk);
            tokio::select! {
                res = &mut walk => Some(res),
                _ = cancel_requested(&mut cancel_rx) => None,
            }
        };
        lock_map(&self.cancels).remove(run_id);

        let Some(walk_result) = walk_outcome else {
            // Aborted: cancel_run owns the finalize.
            return Ok(());
        };

        match walk_result {
            Ok(result) => {
                // A8 — cancel_run can finalize while the walk is mid-flight;
                // re-check before trusting the walk's own verdict.
                if self.is_now_terminal(run_id).await? {
                    return Ok(());
                }
                match result {
                    WalkResult::Parked => {
                        self.emit_by_id(run_id).await?;
                        Ok(())
                    }
                    WalkResult::Failed { error } => {
                        self.finalize_and_emit(run_id, TerminalStatus::Failed, Some(error))
                            .await
                    }
                    WalkResult::Done => {
                        self.finalize_and_emit(run_id, TerminalStatus::Succeeded, None)
                            .await
                    }
                }
            }
            Err(StoreError::TerminalRun { .. }) => Ok(()),
            Err(err) => {
                tracing::error!(run_id, error = %err, "automation advance crashed");
                if self.is_now_terminal(run_id).await? {
                    return Ok(());
                }
                self.finalize_and_emit(run_id, TerminalStatus::Failed, Some(err.to_string()))
                    .await
            }
        }
    }

    /// Decision 12: a `running` entry found before this advance means a
    /// previous engine died mid-action. Idempotent run_action steps are left
    /// as-is (the walk re-executes them); everything else fails with "effect
    /// unknown", and without `keepGoing` the whole run fails right here.
    async fn resolve_stale_running(&self, run: &RunRecord) -> Result<Option<String>, StoreError> {
        for (step_ref, entry) in &run.checkpoint.steps {
            if entry.status != StepStatus::Running {
                continue;
            }
            let step = find_step_by_id(&run.checkpoint.definition.steps, &entry.step_id);
            if step.is_some_and(|s| self.is_restart_safe(s)) {
                continue;
            }
            let step_ref = step_ref.clone();
            self.deps
                .store
                .patch_checkpoint(&run.id, move |cp| {
                    fail_step_entry(cp, &step_ref, RESTART_MID_ACTION_ERROR);
                })
                .await?;
            if !step.is_some_and(Step::keep_going) {
                return Ok(Some(RESTART_MID_ACTION_ERROR.to_string()));
            }
        }
        Ok(None)
    }

    fn is_restart_safe(&self, step: &Step) -> bool {
        match step {
            Step::RunAction(action) => self
                .deps
                .is_idempotent
                .as_ref()
                .is_some_and(|hook| hook(action)),
            _ => false,
        }
    }

    pub(crate) async fn finalize_and_emit(
        &self,
        run_id: &str,
        status: TerminalStatus,
        error: Option<String>,
    ) -> Result<(), StoreError> {
        match self.deps.store.finalize(run_id, status, error).await {
            Ok((record, _)) => {
                self.emit(&record);
                Ok(())
            }
            // Lost the race to cancel_run — its verdict stands.
            Err(StoreError::TerminalRun { .. }) => Ok(()),
            Err(err) => Err(err),
        }
    }

    async fn is_now_terminal(&self, run_id: &str) -> Result<bool, StoreError> {
        Ok(self
            .deps
            .store
            .get_run(run_id)
            .await?
            .is_none_or(|run| run.status.is_terminal()))
    }

    fn emit(&self, run: &RunRecord) {
        self.deps.events.emit(AutomationEvent::RunUpdated {
            run: to_run_summary(run),
        });
    }

    async fn emit_by_id(&self, run_id: &str) -> Result<(), StoreError> {
        if let Some(run) = self.deps.store.get_run(run_id).await? {
            self.emit(&run);
        }
        Ok(())
    }

    fn lease(&self, run_id: &str) -> Arc<TokioMutex<()>> {
        lock_map(&self.in_flight)
            .entry(run_id.to_string())
            .or_default()
            .clone()
    }

    /// Drops the per-run lock entry once nobody else holds it (checked under
    /// the map mutex, so no new clone can race the removal).
    fn release(&self, run_id: &str, lock: Arc<TokioMutex<()>>) {
        let mut map = lock_map(&self.in_flight);
        if map
            .get(run_id)
            .is_some_and(|entry| Arc::ptr_eq(entry, &lock) && Arc::strong_count(entry) == 2)
        {
            map.remove(run_id);
        }
    }

    fn register_cancel(&self, run_id: &str) -> watch::Receiver<bool> {
        let (tx, rx) = watch::channel(false);
        lock_map(&self.cancels).insert(run_id.to_string(), tx);
        rx
    }
}

impl RunAdvancer for Interpreter {
    fn advance_run<'a>(&'a self, run_id: &'a str) -> BoxFuture<'a, Result<(), StoreError>> {
        Box::pin(self.advance(run_id))
    }

    fn fail_run<'a>(
        &'a self,
        run_id: &'a str,
        error: &'a str,
    ) -> BoxFuture<'a, Result<(), StoreError>> {
        Box::pin(async move {
            self.finalize_and_emit(run_id, TerminalStatus::Failed, Some(error.to_string()))
                .await
        })
    }
}

/// Resolves when cancel is requested; pends forever otherwise (the walk
/// branch of the `select!` finishes first).
async fn cancel_requested(rx: &mut watch::Receiver<bool>) {
    if *rx.borrow() {
        return;
    }
    while rx.changed().await.is_ok() {
        if *rx.borrow() {
            return;
        }
    }
    std::future::pending::<()>().await
}

/// A poisoned map mutex only means another task panicked mid-insert; the
/// map itself is still coherent (db.rs precedent).
fn lock_map<T>(mutex: &StdMutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T4.1, A8), not a TS port
// confidence: high
// todos: 0
// notes: cancellation aborts the walk structurally (future drop via select!)
//        instead of Node's cooperative AbortSignal; the A8 store guard
//        rejects any straggler commit. sweep_deadlines/fail_step land with
//        the agent phase (T4.3+).
