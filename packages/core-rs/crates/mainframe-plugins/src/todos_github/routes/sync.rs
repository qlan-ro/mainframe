//! `POST /sync` and `GET /report` — running a sync and reading back its
//! report.

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Json, Query, State};
use axum::http::StatusCode;
use serde_json::{Value, json};

use crate::PluginContext;
use crate::PluginError;
use crate::db_context::{Row, text};
use crate::todos_github::run::{self, RunError};
use crate::todos_github::store;

use super::{as_non_empty_string, conflict, json_response, map_winner, not_found, server_error};

pub(crate) async fn post_sync(
    State(ctx): State<Arc<PluginContext>>,
    Json(body): Json<Value>,
) -> axum::response::Response {
    let Some(project_id) = as_non_empty_string(&body, "projectId") else {
        return super::bad_request("projectId required");
    };
    let run = match run::run_sync(&ctx, &project_id).await {
        Ok(run) => run,
        Err(RunError::AlreadyRunning) => {
            return conflict("A sync is already running for this project.");
        }
        Err(RunError::NotLinked) => {
            return not_found("GitHub sync is not linked for this project.");
        }
        Err(RunError::Failed(err)) => return server_error(err),
    };
    let overwrites = match report_row_count(&ctx, &run.id).await {
        Ok(n) => n,
        Err(err) => return server_error(err),
    };
    json_response(
        StatusCode::OK,
        json!({ "run": run_summary_json(&run, overwrites) }),
    )
}

pub(crate) async fn get_report(
    State(ctx): State<Arc<PluginContext>>,
    Query(params): Query<HashMap<String, String>>,
) -> axum::response::Response {
    let project_id = match super::require_project_id(&params) {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let run = match params.get("runId") {
        Some(run_id) => read_run_by_id(&ctx, &project_id, run_id).await,
        None => store::latest_run(&ctx, &project_id).await,
    };
    let run = match run {
        Ok(run) => run,
        Err(err) => return server_error(err),
    };
    let Some(run) = run else {
        return json_response(StatusCode::OK, json!({ "report": null }));
    };
    let rows = match store::read_report(&ctx, &run.id).await {
        Ok(rows) => rows,
        Err(err) => return server_error(err),
    };
    json_response(
        StatusCode::OK,
        json!({ "report": report_json(&run, &rows) }),
    )
}

async fn report_row_count(ctx: &PluginContext, run_id: &str) -> Result<i64, PluginError> {
    let row = ctx
        .db
        .query_one(
            "SELECT COUNT(*) as n FROM github_report_rows WHERE run_id = ?".into(),
            vec![text(run_id.to_string())],
        )
        .await?;
    Ok(row
        .and_then(|r| r.get("n").and_then(Value::as_i64))
        .unwrap_or(0))
}

async fn read_run_by_id(
    ctx: &PluginContext,
    project_id: &str,
    run_id: &str,
) -> Result<Option<store::Run>, PluginError> {
    let row = ctx
        .db
        .query_one(
            "SELECT * FROM github_runs WHERE id = ? AND project_id = ?".into(),
            vec![text(run_id.to_string()), text(project_id.to_string())],
        )
        .await?;
    Ok(row.map(row_to_run))
}

fn row_to_run(row: Row) -> store::Run {
    store::Run {
        id: str_col(&row, "id"),
        project_id: str_col(&row, "project_id"),
        started_at: str_col(&row, "started_at"),
        finished_at: str_col(&row, "finished_at"),
        pairs_reconciled: int_col(&row, "pairs_reconciled"),
        reached: int_col(&row, "reached"),
        total: int_col(&row, "total"),
        failure_kind: row
            .get("failure_kind")
            .and_then(Value::as_str)
            .map(str::to_string),
        failure_message: row
            .get("failure_message")
            .and_then(Value::as_str)
            .map(str::to_string),
    }
}

fn str_col(row: &Row, key: &str) -> String {
    row.get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn int_col(row: &Row, key: &str) -> i64 {
    row.get(key).and_then(Value::as_i64).unwrap_or(0)
}

fn run_summary_json(run: &store::Run, overwrites: i64) -> Value {
    json!({
        "runId": run.id,
        "finishedAt": run.finished_at,
        "pairsReconciled": run.pairs_reconciled,
        "overwrites": overwrites,
        "failure": failure_json(run),
        "reached": run.reached,
        "total": run.total,
    })
}

fn report_json(run: &store::Run, rows: &[store::ReportRow]) -> Value {
    json!({
        "runId": run.id,
        "finishedAt": run.finished_at,
        "pairsReconciled": run.pairs_reconciled,
        "failure": failure_json(run),
        "rows": rows.iter().map(report_row_json).collect::<Vec<_>>(),
    })
}

fn report_row_json(row: &store::ReportRow) -> Value {
    json!({
        "id": row.id,
        "todoNumber": row.todo_number,
        "todoTitle": row.todo_title,
        "issueNumber": row.issue_number,
        "field": row.field,
        "winner": map_winner(&row.winner),
        "rule": row.rule,
        "localAt": row.local_at,
        "remoteAt": row.remote_at,
        "remoteCoarse": row.remote_coarse,
        "winningValue": row.winning_value,
        "replacedValue": row.replaced_value,
    })
}

fn failure_json(run: &store::Run) -> Option<Value> {
    let kind = run.failure_kind.as_deref()?;
    Some(json!({
        "kind": map_failure_kind(kind),
        "message": run.failure_message.clone().unwrap_or_default(),
        "reached": run.reached,
        "total": run.total,
    }))
}

/// Collapses the driver's five internal stop reasons onto the frozen 3-value
/// wire union; the UI only ever displays `message`, never branches on `kind`,
/// so unmapped reasons (`unavailable`, `internal`) fall back to `network`.
fn map_failure_kind(kind: &str) -> &'static str {
    match kind {
        "auth" => "auth",
        "rate_limited" => "rate-limit",
        _ => "network",
    }
}
