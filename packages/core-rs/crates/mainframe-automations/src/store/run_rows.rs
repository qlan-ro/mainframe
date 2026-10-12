//! Row mapping and in-transaction helpers shared by `RunStore` and
//! `InteractionStore::resolve_interaction` (both write the runs table).

use mainframe_db::sql_types::{FromRow, query_opt};
use rusqlite::{Connection, Row, Transaction, params};

use crate::domain::AutomationDefinition;
use crate::error::{MAX_STEP_OUTPUT_BYTES, StoreError};

use super::columns::{enum_column, json_column};
use super::{AutomationCheckpoint, RunRecord, RunTriggerContext, RunTriggerKind, epoch_ms_now};

impl FromRow for RunRecord {
    type Error = StoreError;

    fn from_row(row: &Row<'_>) -> Result<Self, StoreError> {
        let id: String = row.get("id")?;
        Ok(Self {
            automation_id: row.get("automation_id")?,
            status: enum_column(row, "status", "run status", &id)?,
            checkpoint: json_column(row, "checkpoint", "run checkpoint", &id)?,
            started_at: row.get("started_at")?,
            finished_at: row.get("finished_at")?,
            id,
        })
    }
}

pub(crate) fn get_by_id(conn: &Connection, id: &str) -> Result<Option<RunRecord>, StoreError> {
    query_opt(conn, "SELECT * FROM automation_runs WHERE id = ?1", [id])
}

pub(crate) fn require(conn: &Connection, id: &str) -> Result<RunRecord, StoreError> {
    get_by_id(conn, id)?.ok_or_else(|| StoreError::NotFound {
        kind: "automation run",
        id: id.to_string(),
    })
}

/// A8 guard — returns the run so callers reuse the read.
pub(crate) fn assert_not_terminal(
    tx: &Transaction<'_>,
    run_id: &str,
) -> Result<RunRecord, StoreError> {
    let run = require(tx, run_id)?;
    if run.status.is_terminal() {
        return Err(StoreError::TerminalRun {
            run_id: run_id.to_string(),
            status: run.status,
        });
    }
    Ok(run)
}

pub(crate) fn assert_step_outputs_within_cap(
    checkpoint: &AutomationCheckpoint,
) -> Result<(), StoreError> {
    for (step_ref, step) in &checkpoint.steps {
        let Some(outputs) = &step.outputs else {
            continue;
        };
        let bytes = serde_json::to_string(outputs)?.len();
        if bytes > MAX_STEP_OUTPUT_BYTES {
            return Err(StoreError::StepOutputsTooLarge {
                step_ref: step_ref.clone(),
                bytes,
            });
        }
    }
    Ok(())
}

pub(crate) fn cancel_pending_interactions(
    tx: &Transaction<'_>,
    run_id: &str,
    now: i64,
) -> Result<Vec<String>, StoreError> {
    let mut stmt = tx.prepare(
        "SELECT id FROM automation_interactions WHERE run_id = ?1 AND status = 'pending'",
    )?;
    let ids: Vec<String> = stmt
        .query_map(params![run_id], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    drop(stmt);
    if !ids.is_empty() {
        tx.execute(
            "UPDATE automation_interactions SET status = 'cancelled', resolved_at = ?2 WHERE run_id = ?1 AND status = 'pending'",
            params![run_id, now],
        )?;
    }
    Ok(ids)
}

/// Overwrites a corrupt row's checkpoint with a minimal stub recording the
/// corruption — the original JSON cannot be parsed, let alone mutated.
pub(crate) fn finalize_corrupt_run(conn: &Connection, run_id: &str) -> Result<(), StoreError> {
    let stub = AutomationCheckpoint {
        definition: AutomationDefinition {
            triggers: vec![],
            steps: vec![],
        },
        trigger: RunTriggerContext {
            kind: RunTriggerKind::Manual,
            trigger_id: None,
            scheduled_for: None,
            payload: None,
        },
        steps: std::collections::BTreeMap::new(),
        wake_at: None,
        error: Some("corrupt checkpoint".to_string()),
    };
    conn.execute(
        "UPDATE automation_runs SET checkpoint = ?2, status = 'failed', finished_at = ?3 WHERE id = ?1",
        params![run_id, serde_json::to_string(&stub)?, epoch_ms_now()],
    )?;
    Ok(())
}

pub(crate) fn is_unique_violation(err: &rusqlite::Error) -> bool {
    matches!(
        err,
        rusqlite::Error::SqliteFailure(e, _)
            if e.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE
    )
}
