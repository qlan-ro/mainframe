//! Reads the local task row and decides whether a dispute is even possible
//! before spending an extra GitHub call: `issue_field_times` only matters when
//! both sides moved a dated field since the baseline (task 15's cost note).

use serde_json::Value;

use crate::PluginError;
use crate::context::PluginContext;
use crate::db_context::text;
use crate::github_port::IssueSnapshot;
use crate::todos::safe_json_array;
use crate::todos_github::reconcile::Baseline;

pub(super) struct LocalRow {
    pub number: i64,
    pub title: String,
    pub body: String,
    pub status: String,
    pub labels: Vec<String>,
}

pub(super) async fn fetch_local(
    ctx: &PluginContext,
    todo_id: &str,
) -> Result<Option<LocalRow>, PluginError> {
    let row = ctx
        .db
        .query_one(
            "SELECT number, title, body, status, labels FROM todos WHERE id = ?".into(),
            vec![text(todo_id.to_string())],
        )
        .await?;
    Ok(row.map(|row| {
        let raw_labels = row.get("labels").and_then(Value::as_str).unwrap_or("[]");
        let labels = safe_json_array(raw_labels, "labels", todo_id)
            .into_iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect();
        LocalRow {
            number: row.get("number").and_then(Value::as_i64).unwrap_or(0),
            title: str_col(&row, "title"),
            body: str_col(&row, "body"),
            status: str_col(&row, "status"),
            labels,
        }
    }))
}

fn str_col(row: &crate::db_context::Row, key: &str) -> String {
    row.get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

/// Mirrors `reconcile::state`'s open/closed projection and its
/// in-progress-close exception (kept local to avoid exposing reconcile's
/// private internals crate-wide for a call-avoidance heuristic only).
pub(super) fn needs_field_times(
    local: &LocalRow,
    baseline: &Baseline,
    issue: &IssueSnapshot,
) -> bool {
    let issue_state = project_issue_state(issue);
    let title_dispute = local.title != baseline.title && issue.title != baseline.title;

    let local_projected = if local.status == "done" {
        "closed"
    } else {
        "open"
    };
    let in_progress_close = local.status == "in_progress" && issue_state == "closed";
    let state_dispute =
        !in_progress_close && local_projected != baseline.state && issue_state != baseline.state;

    title_dispute || state_dispute
}

pub(super) fn project_issue_state(issue: &IssueSnapshot) -> &'static str {
    match issue.state {
        crate::github_port::IssueState::Open => "open",
        crate::github_port::IssueState::Closed => "closed",
    }
}
