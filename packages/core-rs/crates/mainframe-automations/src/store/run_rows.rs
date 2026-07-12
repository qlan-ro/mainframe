//! Row mapping and in-transaction helpers shared by `RunStore` and
//! `InteractionStore::resolve_interaction` (both write the runs table).

use rusqlite::{Connection, OptionalExtension, Row, Transaction, params};

use crate::domain::AutomationDefinition;
use crate::error::{MAX_STEP_OUTPUT_BYTES, StoreError};

use super::{
    AutomationCheckpoint, RunRecord, RunStatus, RunTriggerContext, RunTriggerKind, epoch_ms_now,
    parse_db_enum,
};

pub(crate) struct RowParts {
    pub id: String,
    pub automation_id: String,
    pub status: String,
    pub checkpoint: String,
    pub started_at: i64,
    pub finished_at: Option<i64>,
}

pub(crate) fn row_to_parts(row: &Row<'_>) -> rusqlite::Result<RowParts> {
    Ok(RowParts {
        id: row.get("id")?,
        automation_id: row.get("automation_id")?,
        status: row.get("status")?,
        checkpoint: row.get("checkpoint")?,
        started_at: row.get("started_at")?,
        finished_at: row.get("finished_at")?,
    })
}

pub(crate) fn parts_to_record(parts: RowParts) -> Result<RunRecord, StoreError> {
    let checkpoint: AutomationCheckpoint =
        serde_json::from_str(&parts.checkpoint).map_err(|source| StoreError::Corrupt {
            what: "run checkpoint",
            id: parts.id.clone(),
            source,
        })?;
    let status: RunStatus = parse_db_enum(&parts.status, "run status", &parts.id)?;
    Ok(RunRecord {
        id: parts.id,
        automation_id: parts.automation_id,
        status,
        checkpoint,
        started_at: parts.started_at,
        finished_at: parts.finished_at,
    })
}

pub(crate) fn get_by_id(conn: &Connection, id: &str) -> Result<Option<RunRecord>, StoreError> {
    let mut stmt = conn.prepare("SELECT * FROM automation_runs WHERE id = ?1")?;
    let parts = stmt.query_row(params![id], row_to_parts).optional()?;
    parts.map(parts_to_record).transpose()
}

pub(crate) fn require(conn: &Connection, id: &str) -> Result<RunRecord, StoreError> {
    get_by_id(conn, id)?.ok_or_else(|| StoreError::NotFound {
        kind: "automation run",
        id: id.to_string(),
    })
}

/// A8 guard — returns the raw row so callers reuse the read.
pub(crate) fn assert_not_terminal(
    tx: &Transaction<'_>,
    run_id: &str,
) -> Result<RowParts, StoreError> {
    let parts = tx
        .query_row(
            "SELECT * FROM automation_runs WHERE id = ?1",
            params![run_id],
            row_to_parts,
        )
        .optional()?
        .ok_or_else(|| StoreError::NotFound {
            kind: "automation run",
            id: run_id.to_string(),
        })?;
    let status: RunStatus = parse_db_enum(&parts.status, "run status", run_id)?;
    if status.is_terminal() {
        return Err(StoreError::TerminalRun {
            run_id: run_id.to_string(),
            status,
        });
    }
    Ok(parts)
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

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T2.2), not a TS port
// confidence: high
// todos: 0
// notes: split from run_store.rs for the 300-line file cap.
