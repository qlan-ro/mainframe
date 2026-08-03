//! `github_runs` + `github_report_rows` — sync-run history and the per-field
//! overwrite report for each run, pruned to the last ten runs per project
//! (AC23).

use crate::PluginError;
use crate::context::PluginContext;
use crate::db_context::{Row, int, nullable_text, text};

use super::{col_bool, col_i64, col_opt_str, col_str};

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

pub async fn insert_run(ctx: &PluginContext, run: &Run) -> Result<(), PluginError> {
    ctx.db
        .execute(
            "INSERT INTO github_runs
               (id, project_id, started_at, finished_at, pairs_reconciled, reached, total, failure_kind, failure_message)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
                .into(),
            vec![
                text(run.id.clone()),
                text(run.project_id.clone()),
                text(run.started_at.clone()),
                text(run.finished_at.clone()),
                int(run.pairs_reconciled),
                int(run.reached),
                int(run.total),
                nullable_text(run.failure_kind.clone()),
                nullable_text(run.failure_message.clone()),
            ],
        )
        .await
}

pub async fn latest_run(ctx: &PluginContext, project_id: &str) -> Result<Option<Run>, PluginError> {
    let row = ctx
        .db
        .query_one(
            // `rowid` breaks ties for runs started within the same second —
            // `started_at` alone is not a stable sort key at that resolution.
            "SELECT * FROM github_runs WHERE project_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1"
                .into(),
            vec![text(project_id.to_string())],
        )
        .await?;
    Ok(row.map(row_to_run))
}

/// Deletes every run past the most recent `keep`, cascading to its report
/// rows first (no FK — the app layer owns the order, same as fact 5's cascade).
pub async fn prune_runs(
    ctx: &PluginContext,
    project_id: &str,
    keep: i64,
) -> Result<(), PluginError> {
    ctx.db
        .execute(
            "DELETE FROM github_report_rows WHERE run_id IN (
               SELECT id FROM github_runs WHERE project_id = ?
               ORDER BY started_at DESC, rowid DESC LIMIT -1 OFFSET ?
             )"
            .into(),
            vec![text(project_id.to_string()), int(keep)],
        )
        .await?;
    ctx.db
        .execute(
            "DELETE FROM github_runs WHERE project_id = ? AND id NOT IN (
               SELECT id FROM github_runs WHERE project_id = ?
               ORDER BY started_at DESC, rowid DESC LIMIT ?
             )"
            .into(),
            vec![
                text(project_id.to_string()),
                text(project_id.to_string()),
                int(keep),
            ],
        )
        .await
}

pub async fn insert_report_rows(
    ctx: &PluginContext,
    rows: &[ReportRow],
) -> Result<(), PluginError> {
    for row in rows {
        ctx.db
            .execute(
                "INSERT INTO github_report_rows
                   (id, run_id, todo_id, todo_number, todo_title, issue_number, field, winner, rule,
                    local_at, remote_at, remote_coarse, winning_value, replaced_value)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                    .into(),
                vec![
                    text(row.id.clone()),
                    text(row.run_id.clone()),
                    text(row.todo_id.clone()),
                    int(row.todo_number),
                    text(row.todo_title.clone()),
                    int(row.issue_number),
                    text(row.field.clone()),
                    text(row.winner.clone()),
                    text(row.rule.clone()),
                    nullable_text(row.local_at.clone()),
                    nullable_text(row.remote_at.clone()),
                    int(row.remote_coarse as i64),
                    text(row.winning_value.clone()),
                    text(row.replaced_value.clone()),
                ],
            )
            .await?;
    }
    Ok(())
}

pub async fn read_report(ctx: &PluginContext, run_id: &str) -> Result<Vec<ReportRow>, PluginError> {
    let rows = ctx
        .db
        .query_all(
            "SELECT * FROM github_report_rows WHERE run_id = ?".into(),
            vec![text(run_id.to_string())],
        )
        .await?;
    Ok(rows.into_iter().map(row_to_report_row).collect())
}

fn row_to_run(row: Row) -> Run {
    Run {
        id: col_str(&row, "id"),
        project_id: col_str(&row, "project_id"),
        started_at: col_str(&row, "started_at"),
        finished_at: col_str(&row, "finished_at"),
        pairs_reconciled: col_i64(&row, "pairs_reconciled"),
        reached: col_i64(&row, "reached"),
        total: col_i64(&row, "total"),
        failure_kind: col_opt_str(&row, "failure_kind"),
        failure_message: col_opt_str(&row, "failure_message"),
    }
}

fn row_to_report_row(row: Row) -> ReportRow {
    ReportRow {
        id: col_str(&row, "id"),
        run_id: col_str(&row, "run_id"),
        todo_id: col_str(&row, "todo_id"),
        todo_number: col_i64(&row, "todo_number"),
        todo_title: col_str(&row, "todo_title"),
        issue_number: col_i64(&row, "issue_number"),
        field: col_str(&row, "field"),
        winner: col_str(&row, "winner"),
        rule: col_str(&row, "rule"),
        local_at: col_opt_str(&row, "local_at"),
        remote_at: col_opt_str(&row, "remote_at"),
        remote_coarse: col_bool(&row, "remote_coarse"),
        winning_value: col_str(&row, "winning_value"),
        replaced_value: col_str(&row, "replaced_value"),
    }
}
