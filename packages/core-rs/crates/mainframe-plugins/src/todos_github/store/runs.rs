//! `github_runs` + `github_report_rows` — sync-run history and the per-field
//! overwrite report for each run, pruned to the last ten runs per project
//! (AC23).

use mainframe_db::sql_types::{FromRow, SqlBool, query_all, query_opt};
use rusqlite::{Connection, params};

use crate::PluginError;
use crate::context::PluginContext;

#[derive(Debug, Clone, PartialEq)]
pub struct Run {
    pub id: String,
    pub project_id: String,
    pub started_at: String,
    pub finished_at: String,
    pub pairs_reconciled: i64,
    pub reached: i64,
    pub total: i64,
    pub failure_kind: Option<String>,
    pub failure_message: Option<String>,
}

impl FromRow for Run {
    type Error = PluginError;

    fn from_row(row: &rusqlite::Row<'_>) -> Result<Self, PluginError> {
        Ok(Self {
            id: row.get("id")?,
            project_id: row.get("project_id")?,
            started_at: row.get("started_at")?,
            finished_at: row.get("finished_at")?,
            pairs_reconciled: row.get("pairs_reconciled")?,
            reached: row.get("reached")?,
            total: row.get("total")?,
            failure_kind: row.get("failure_kind")?,
            failure_message: row.get("failure_message")?,
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReportRow {
    pub id: String,
    pub run_id: String,
    pub todo_id: String,
    pub todo_number: i64,
    pub todo_title: String,
    pub issue_number: i64,
    pub field: String,
    pub winner: String,
    pub rule: String,
    pub local_at: Option<String>,
    pub remote_at: Option<String>,
    pub remote_coarse: bool,
    pub winning_value: String,
    pub replaced_value: String,
}

impl FromRow for ReportRow {
    type Error = PluginError;

    fn from_row(row: &rusqlite::Row<'_>) -> Result<Self, PluginError> {
        Ok(Self {
            id: row.get("id")?,
            run_id: row.get("run_id")?,
            todo_id: row.get("todo_id")?,
            todo_number: row.get("todo_number")?,
            todo_title: row.get("todo_title")?,
            issue_number: row.get("issue_number")?,
            field: row.get("field")?,
            winner: row.get("winner")?,
            rule: row.get("rule")?,
            local_at: row.get("local_at")?,
            remote_at: row.get("remote_at")?,
            remote_coarse: row.get::<_, SqlBool>("remote_coarse")?.0,
            winning_value: row.get("winning_value")?,
            replaced_value: row.get("replaced_value")?,
        })
    }
}

/// Records a finished run: stamps the link's `last_synced_at`, writes the run
/// with its report rows and prunes the project's history to the most recent
/// `keep` runs, in one transaction. When the link was deleted while the run
/// was in flight nothing is written, so neither the link nor a report of the
/// unlinked repo comes back, and this returns `false`.
pub(crate) async fn finish_run(
    ctx: &PluginContext,
    run: &Run,
    report_rows: &[ReportRow],
    keep: i64,
) -> Result<bool, PluginError> {
    let (run, report_rows) = (run.clone(), report_rows.to_vec());
    ctx.db()?
        .call_mut(move |db| {
            let transaction = db.transaction()?;
            let linked = transaction.execute(
                "UPDATE github_links SET last_synced_at = ? WHERE project_id = ?",
                params![run.finished_at, run.project_id],
            )?;
            if linked == 0 {
                return Ok(false);
            }
            insert_run(&transaction, &run)?;
            for row in &report_rows {
                insert_report_row(&transaction, row)?;
            }
            prune_runs_in(&transaction, &run.project_id, keep)?;
            transaction.commit()?;
            Ok(true)
        })
        .await
}

fn insert_run(db: &Connection, run: &Run) -> rusqlite::Result<()> {
    db.execute(
        "INSERT INTO github_runs
           (id, project_id, started_at, finished_at, pairs_reconciled, reached, total, failure_kind, failure_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            run.id,
            run.project_id,
            run.started_at,
            run.finished_at,
            run.pairs_reconciled,
            run.reached,
            run.total,
            run.failure_kind,
            run.failure_message,
        ],
    )?;
    Ok(())
}

fn insert_report_row(db: &Connection, row: &ReportRow) -> rusqlite::Result<()> {
    db.execute(
        "INSERT INTO github_report_rows
           (id, run_id, todo_id, todo_number, todo_title, issue_number, field, winner, rule,
            local_at, remote_at, remote_coarse, winning_value, replaced_value)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            row.id,
            row.run_id,
            row.todo_id,
            row.todo_number,
            row.todo_title,
            row.issue_number,
            row.field,
            row.winner,
            row.rule,
            row.local_at,
            row.remote_at,
            SqlBool(row.remote_coarse),
            row.winning_value,
            row.replaced_value,
        ],
    )?;
    Ok(())
}

/// Deletes every run past the most recent `keep`, report rows first, because
/// the tables have no foreign keys to cascade.
pub(crate) fn prune_runs_in(db: &Connection, project_id: &str, keep: i64) -> rusqlite::Result<()> {
    db.execute(
        "DELETE FROM github_report_rows WHERE run_id IN (
           SELECT id FROM github_runs WHERE project_id = ?
           ORDER BY started_at DESC, rowid DESC LIMIT -1 OFFSET ?
         )",
        params![project_id, keep],
    )?;
    db.execute(
        "DELETE FROM github_runs WHERE project_id = ?1 AND id NOT IN (
           SELECT id FROM github_runs WHERE project_id = ?1
           ORDER BY started_at DESC, rowid DESC LIMIT ?2
         )",
        params![project_id, keep],
    )?;
    Ok(())
}

pub(crate) async fn latest_run(
    ctx: &PluginContext,
    project_id: &str,
) -> Result<Option<Run>, PluginError> {
    let project_id = project_id.to_string();
    ctx.db()?
        .call(move |db| {
            // `rowid` breaks ties for runs started within the same second —
            // `started_at` alone is not a stable sort key at that resolution.
            query_opt(
                db,
                "SELECT * FROM github_runs WHERE project_id = ?
                 ORDER BY started_at DESC, rowid DESC LIMIT 1",
                [project_id],
            )
        })
        .await
}

/// The run `run_id`, only if it belongs to `project_id`.
pub(crate) async fn read_run(
    ctx: &PluginContext,
    project_id: &str,
    run_id: &str,
) -> Result<Option<Run>, PluginError> {
    let (project_id, run_id) = (project_id.to_string(), run_id.to_string());
    ctx.db()?
        .call(move |db| {
            query_opt(
                db,
                "SELECT * FROM github_runs WHERE id = ? AND project_id = ?",
                params![run_id, project_id],
            )
        })
        .await
}

pub(crate) async fn read_report(
    ctx: &PluginContext,
    run_id: &str,
) -> Result<Vec<ReportRow>, PluginError> {
    let run_id = run_id.to_string();
    ctx.db()?
        .call(move |db| {
            query_all(
                db,
                "SELECT * FROM github_report_rows WHERE run_id = ? ORDER BY rowid",
                [run_id],
            )
        })
        .await
}
