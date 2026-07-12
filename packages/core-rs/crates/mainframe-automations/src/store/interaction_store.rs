//! Interaction persistence and the one-transaction resolve (contract §3):
//! claiming `pending→answered` and writing the answers into the run
//! checkpoint commit atomically — a crash cannot strand an `answered`
//! interaction against a still-`waiting` step.

use nanoid::nanoid;
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde_json::Value;

use crate::domain::AutomationFormField;
use crate::error::StoreError;

use super::run_rows::{assert_step_outputs_within_cap, require as require_run};
use super::{
    AutomationCheckpoint, AutomationDb, InteractionRecord, InteractionStatus, StepStatus,
    derive_run_status, epoch_ms_now, parse_db_enum,
};

#[derive(Clone)]
pub struct InteractionStore {
    db: AutomationDb,
}

impl InteractionStore {
    pub fn new(db: AutomationDb) -> Self {
        Self { db }
    }

    pub async fn create(
        &self,
        run_id: &str,
        step_ref: &str,
        title: &str,
        fields: Vec<AutomationFormField>,
    ) -> Result<InteractionRecord, StoreError> {
        let (run_id, step_ref, title) =
            (run_id.to_string(), step_ref.to_string(), title.to_string());
        self.db
            .call(move |conn| {
                let id = nanoid!();
                conn.execute(
                    "INSERT INTO automation_interactions (id, run_id, step_ref, title, fields, status, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6)",
                    params![
                        id,
                        run_id,
                        step_ref,
                        title,
                        serde_json::to_string(&fields)?,
                        epoch_ms_now(),
                    ],
                )?;
                require(conn, &id)
            })
            .await
    }

    pub async fn get(&self, id: &str) -> Result<Option<InteractionRecord>, StoreError> {
        let id = id.to_string();
        self.db.call(move |conn| get_by_id(conn, &id)).await
    }

    pub async fn find_pending_for_step(
        &self,
        run_id: &str,
        step_ref: &str,
    ) -> Result<Option<InteractionRecord>, StoreError> {
        let (run_id, step_ref) = (run_id.to_string(), step_ref.to_string());
        self.db
            .call(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT * FROM automation_interactions WHERE run_id = ?1 AND step_ref = ?2 AND status = 'pending'",
                )?;
                let parts = stmt
                    .query_row(params![run_id, step_ref], row_to_parts)
                    .optional()?;
                parts.map(parts_to_record).transpose()
            })
            .await
    }

    pub async fn list_pending(&self) -> Result<Vec<InteractionRecord>, StoreError> {
        self.db
            .call(|conn| {
                let mut stmt = conn.prepare(
                    "SELECT * FROM automation_interactions WHERE status = 'pending' ORDER BY created_at",
                )?;
                let rows = stmt.query_map([], row_to_parts)?;
                rows.map(|r| parts_to_record(r?)).collect()
            })
            .await
    }

    /// Claims `pending→answered` and commits the answers as the parked
    /// step's Record output in ONE transaction. Returns `false` when the
    /// interaction was already answered or cancelled (the second claim).
    /// Any failure past the claim rolls the claim back with it.
    pub async fn resolve_interaction(
        &self,
        id: &str,
        answers: serde_json::Map<String, Value>,
    ) -> Result<bool, StoreError> {
        let id = id.to_string();
        self.db
            .call(move |conn| {
                let now = epoch_ms_now();
                let tx = conn.transaction()?;

                let interaction = tx
                    .query_row(
                        "SELECT * FROM automation_interactions WHERE id = ?1",
                        params![id],
                        row_to_parts,
                    )
                    .optional()?
                    .ok_or_else(|| StoreError::NotFound {
                        kind: "automation interaction",
                        id: id.clone(),
                    })?;
                let claimed = tx.execute(
                    "UPDATE automation_interactions SET status = 'answered', resolved_at = ?2 WHERE id = ?1 AND status = 'pending'",
                    params![id, now],
                )?;
                if claimed == 0 {
                    return Ok(false);
                }

                let run = require_run(&tx, &interaction.run_id)?;
                if run.status.is_terminal() {
                    return Err(StoreError::TerminalRun {
                        run_id: run.id,
                        status: run.status,
                    });
                }
                let mut checkpoint = run.checkpoint;
                apply_answers(&mut checkpoint, &interaction.step_ref, answers, now)?;
                assert_step_outputs_within_cap(&checkpoint)?;
                let status = derive_run_status(&checkpoint);
                tx.execute(
                    "UPDATE automation_runs SET checkpoint = ?2, status = ?3 WHERE id = ?1",
                    params![
                        interaction.run_id,
                        serde_json::to_string(&checkpoint)?,
                        status.as_str(),
                    ],
                )?;
                tx.commit()?;
                Ok(true)
            })
            .await
    }

    /// Cancels every pending interaction for a run. Normal run-cancel rides
    /// `RunStore::finalize`'s single transaction — this standalone variant
    /// is the ask_me verb's cleanup when its park loses the cancel race
    /// (the interaction row was created after finalize already swept).
    pub async fn cancel_pending_for_run(&self, run_id: &str) -> Result<Vec<String>, StoreError> {
        let run_id = run_id.to_string();
        self.db
            .call(move |conn| {
                let tx = conn.transaction()?;
                let cancelled =
                    super::run_rows::cancel_pending_interactions(&tx, &run_id, epoch_ms_now())?;
                tx.commit()?;
                Ok(cancelled)
            })
            .await
    }
}

/// Mirrors Node's `applyAnswers` — the parked ask_me entry becomes
/// `succeeded` with the answers as its named outputs.
fn apply_answers(
    checkpoint: &mut AutomationCheckpoint,
    step_ref: &str,
    answers: serde_json::Map<String, Value>,
    now: i64,
) -> Result<(), StoreError> {
    let entry =
        checkpoint
            .steps
            .get_mut(step_ref)
            .ok_or_else(|| StoreError::StepNotInCheckpoint {
                step_ref: step_ref.to_string(),
            })?;
    entry.status = StepStatus::Succeeded;
    entry.outputs = Some(answers);
    entry.error = None;
    entry.finished_at = Some(now);
    Ok(())
}

struct RowParts {
    id: String,
    run_id: String,
    step_ref: String,
    title: String,
    fields: String,
    status: String,
    created_at: i64,
    resolved_at: Option<i64>,
}

fn row_to_parts(row: &Row<'_>) -> rusqlite::Result<RowParts> {
    Ok(RowParts {
        id: row.get("id")?,
        run_id: row.get("run_id")?,
        step_ref: row.get("step_ref")?,
        title: row.get("title")?,
        fields: row.get("fields")?,
        status: row.get("status")?,
        created_at: row.get("created_at")?,
        resolved_at: row.get("resolved_at")?,
    })
}

fn parts_to_record(parts: RowParts) -> Result<InteractionRecord, StoreError> {
    let status: InteractionStatus = parse_db_enum(&parts.status, "interaction status", &parts.id)?;
    Ok(InteractionRecord {
        fields: parse_fields(&parts.fields, &parts.id),
        id: parts.id,
        run_id: parts.run_id,
        step_ref: parts.step_ref,
        title: parts.title,
        status,
        created_at: parts.created_at,
        resolved_at: parts.resolved_at,
    })
}

/// Defensive JSON-array parse (repo convention: never bare-parse a JSON
/// column in a listing path) — a single malformed row must not crash
/// `list_pending`. Written exclusively by `create`, so a failure here means
/// on-disk corruption, not user input.
fn parse_fields(raw: &str, interaction_id: &str) -> Vec<AutomationFormField> {
    match serde_json::from_str(raw) {
        Ok(fields) => fields,
        Err(error) => {
            tracing::warn!(
                interaction_id,
                %error,
                "automation_interactions.fields malformed JSON, defaulting to []"
            );
            Vec::new()
        }
    }
}

fn get_by_id(conn: &Connection, id: &str) -> Result<Option<InteractionRecord>, StoreError> {
    let mut stmt = conn.prepare("SELECT * FROM automation_interactions WHERE id = ?1")?;
    let parts = stmt.query_row(params![id], row_to_parts).optional()?;
    parts.map(parts_to_record).transpose()
}

fn require(conn: &Connection, id: &str) -> Result<InteractionRecord, StoreError> {
    get_by_id(conn, id)?.ok_or_else(|| StoreError::NotFound {
        kind: "automation interaction",
        id: id.to_string(),
    })
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T2.2), not a TS port
// confidence: high
// todos: 0
// notes: resolve mirrors Node's InteractionStore.resolveInOneTx +
//        ask-me.ts applyAnswers; run-cancel's bulk cancel lives in
//        RunStore::finalize (same-transaction requirement).
