//! Run persistence: whole-checkpoint saves with A5 status derivation, A8
//! terminal immutability, the dedup insert race, and boot's resumable scan.

use nanoid::nanoid;
use rusqlite::params;

use crate::domain::AutomationDefinition;
use crate::error::StoreError;

use super::run_rows::{
    RowParts, assert_not_terminal, assert_step_outputs_within_cap, finalize_corrupt_run, get_by_id,
    is_unique_violation, parts_to_record, require, row_to_parts,
};
use super::{
    AutomationCheckpoint, AutomationDb, RunRecord, RunTriggerContext, TerminalStatus,
    derive_run_status, epoch_ms_now,
};

#[derive(Clone)]
pub struct RunStore {
    db: AutomationDb,
}

impl RunStore {
    pub fn new(db: AutomationDb) -> Self {
        Self { db }
    }

    /// Freezes `definition` and `trigger` INSIDE the checkpoint (contract §2).
    /// `dedup_key` is `None` for manual runs — SQLite treats every NULL as
    /// distinct in the unique index, so manual runs never collide, while a
    /// duplicate trigger fire loses the insert race (`DuplicateFire`).
    pub async fn create_run(
        &self,
        automation_id: &str,
        definition: AutomationDefinition,
        trigger: RunTriggerContext,
        dedup_key: Option<String>,
    ) -> Result<RunRecord, StoreError> {
        let automation_id = automation_id.to_string();
        self.db
            .call(move |conn| {
                let id = nanoid!();
                let checkpoint = AutomationCheckpoint::new(definition, trigger);
                let inserted = conn.execute(
                    "INSERT INTO automation_runs (id, automation_id, status, trigger_dedup_key, checkpoint, started_at)
                     VALUES (?1, ?2, 'running', ?3, ?4, ?5)",
                    params![
                        id,
                        automation_id,
                        dedup_key,
                        serde_json::to_string(&checkpoint)?,
                        epoch_ms_now(),
                    ],
                );
                match inserted {
                    Ok(_) => require(conn, &id),
                    Err(err) if is_unique_violation(&err) => Err(StoreError::DuplicateFire {
                        automation_id,
                        dedup_key: dedup_key.unwrap_or_default(),
                    }),
                    Err(err) => Err(err.into()),
                }
            })
            .await
    }

    pub async fn get_run(&self, id: &str) -> Result<Option<RunRecord>, StoreError> {
        let id = id.to_string();
        self.db.call(move |conn| get_by_id(conn, &id)).await
    }

    pub async fn list_runs(
        &self,
        automation_id: &str,
        limit: u32,
    ) -> Result<Vec<RunRecord>, StoreError> {
        let automation_id = automation_id.to_string();
        self.db
            .call(move |conn| {
                // rowid tie-breaks started_at (ms ties on fast successive creates).
                let mut stmt = conn.prepare(
                    "SELECT * FROM automation_runs WHERE automation_id = ?1 ORDER BY started_at DESC, rowid DESC LIMIT ?2",
                )?;
                let rows = stmt.query_map(params![automation_id, limit], row_to_parts)?;
                rows.map(|r| parts_to_record(r?)).collect()
            })
            .await
    }

    /// Boot reconcile's entry point — every `running|waiting` run. One row
    /// with a corrupt checkpoint must not abort the scan for the rest: it is
    /// finalized `failed` in place and excluded.
    pub async fn list_live_runs(&self) -> Result<Vec<RunRecord>, StoreError> {
        self.db
            .call(|conn| {
                let mut stmt = conn.prepare(
                    "SELECT * FROM automation_runs WHERE status IN ('running','waiting')",
                )?;
                let parts: Vec<RowParts> = stmt
                    .query_map([], row_to_parts)?
                    .collect::<Result<_, _>>()?;
                drop(stmt);
                let mut runs = Vec::with_capacity(parts.len());
                for part in parts {
                    let run_id = part.id.clone();
                    match parts_to_record(part) {
                        Ok(run) => runs.push(run),
                        Err(err) => {
                            tracing::error!(
                                run_id,
                                error = %err,
                                "automation run has a corrupt checkpoint; finalizing failed"
                            );
                            finalize_corrupt_run(conn, &run_id)?;
                        }
                    }
                }
                Ok(runs)
            })
            .await
    }

    /// Whole-checkpoint write (the engine single-flights per run). Refuses a
    /// terminal run (A8), enforces the 4 MB per-step outputs cap, and derives
    /// the run-level status from the new checkpoint (A5).
    pub async fn save_checkpoint(
        &self,
        run_id: &str,
        checkpoint: AutomationCheckpoint,
    ) -> Result<RunRecord, StoreError> {
        let run_id = run_id.to_string();
        self.db
            .call(move |conn| {
                let tx = conn.transaction()?;
                assert_not_terminal(&tx, &run_id)?;
                assert_step_outputs_within_cap(&checkpoint)?;
                let status = derive_run_status(&checkpoint);
                tx.execute(
                    "UPDATE automation_runs SET checkpoint = ?2, status = ?3 WHERE id = ?1",
                    params![run_id, serde_json::to_string(&checkpoint)?, status.as_str()],
                )?;
                tx.commit()?;
                require(conn, &run_id)
            })
            .await
    }

    /// Folds `error` into the checkpoint, clears `wakeAt`, stamps
    /// `finished_at`, and cancels the run's pending interactions — all in ONE
    /// transaction (A8). Returns the cancelled interaction ids so the engine
    /// can emit their events. Refuses to re-finalize a terminal run.
    pub async fn finalize(
        &self,
        run_id: &str,
        status: TerminalStatus,
        error: Option<String>,
    ) -> Result<(RunRecord, Vec<String>), StoreError> {
        let run_id = run_id.to_string();
        self.db
            .call(move |conn| {
                let now = epoch_ms_now();
                let tx = conn.transaction()?;
                let parts = assert_not_terminal(&tx, &run_id)?;
                let mut checkpoint: AutomationCheckpoint = serde_json::from_str(&parts.checkpoint)
                    .map_err(|source| StoreError::Corrupt {
                        what: "run checkpoint",
                        id: run_id.clone(),
                        source,
                    })?;
                checkpoint.wake_at = None;
                if error.is_some() {
                    checkpoint.error = error;
                }
                tx.execute(
                    "UPDATE automation_runs SET checkpoint = ?2, status = ?3, finished_at = ?4 WHERE id = ?1",
                    params![
                        run_id,
                        serde_json::to_string(&checkpoint)?,
                        status.run_status().as_str(),
                        now,
                    ],
                )?;
                let cancelled = super::run_rows::cancel_pending_interactions(&tx, &run_id, now)?;
                tx.commit()?;
                Ok((require(conn, &run_id)?, cancelled))
            })
            .await
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T2.2), not a TS port
// confidence: high
// todos: 0
// notes: finalize also cancels the run's pending interactions in the same
//        transaction (A8: run-cancel is atomic with interaction cancel);
//        Node splits this across savepoint-joined store calls. Row mapping
//        and in-tx helpers live in run_rows.rs (300-line file cap).
