//! Reads the local task row and decides whether a dispute is even possible
//! before spending an extra GitHub call: `issue_field_times` only matters when
//! both sides moved a dated field since the baseline (task 15's cost note).

use serde_json::Value;

use crate::PluginError;
use crate::context::PluginContext;
use crate::db_context::text;
use crate::github_port::{IssueSnapshot, RepoRef};
use crate::todos::safe_json_array;
use crate::todos_github::reconcile::{self, Baseline, Reconciliation};
use crate::todos_github::{store, touch};

use super::handle_port_error;

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

/// The read-and-reconcile half of a pair's sync: fetches the local row, the
/// issue, and (only when a dispute is possible) the issue's field times, then
/// runs the pure `reconcile` step. `Ok(None)` covers both "nothing to do"
/// (the todo is gone) and a per-pair port error already recorded by
/// `handle_port_error`; an `Err` is a stop-worthy failure for the whole run.
pub(super) async fn plan_pair(
    ctx: &PluginContext,
    repo: &RepoRef,
    credential_label: &str,
    pair: &store::Pair,
) -> Result<Option<(LocalRow, Reconciliation)>, (&'static str, String)> {
    let Some(local) = fetch_local(ctx, &pair.todo_id)
        .await
        .map_err(super::internal)?
    else {
        return Ok(None);
    };

    let issue = match ctx
        .github
        .get_issue(repo, pair.issue_number as u64, credential_label)
        .await
    {
        Ok(issue) => issue,
        Err(err) => return handle_port_error(ctx, pair, err).await.map(|_| None),
    };

    let baseline = Baseline {
        title: pair.base_title.clone(),
        body: pair.base_body.clone(),
        state: pair.base_state.clone(),
        labels: pair.base_labels.clone(),
    };

    let field_times = if needs_field_times(&local, &baseline, &issue) {
        match ctx
            .github
            .issue_field_times(repo, pair.issue_number as u64, credential_label)
            .await
        {
            Ok(times) => times,
            Err(err) => return handle_port_error(ctx, pair, err).await.map(|_| None),
        }
    } else {
        Default::default()
    };

    let touched = touch::read_touch(ctx, &pair.todo_id)
        .await
        .map_err(super::internal)?;

    let plan = reconcile::reconcile(
        &to_local_task(&local),
        &to_remote_view(&issue, field_times),
        &baseline,
        &to_touch_times(&touched),
    );

    Ok(Some((local, plan)))
}

fn to_local_task(row: &LocalRow) -> reconcile::LocalTask {
    reconcile::LocalTask {
        title: row.title.clone(),
        body: row.body.clone(),
        status: row.status.clone(),
        labels: row.labels.clone(),
    }
}

fn to_remote_view(
    issue: &IssueSnapshot,
    field_times: crate::github_port::IssueFieldTimes,
) -> reconcile::RemoteIssueView {
    reconcile::RemoteIssueView {
        title: issue.title.clone(),
        body: issue.body.clone(),
        state: project_issue_state(issue).to_string(),
        labels: issue.labels.clone(),
        updated_at: issue.updated_at.clone(),
        title_at: field_times.title_at,
        state_at: field_times.state_at,
    }
}

fn to_touch_times(touch: &std::collections::HashMap<String, String>) -> reconcile::TouchTimes {
    reconcile::TouchTimes {
        title_at: touch.get("title").cloned(),
        body_at: touch.get("body").cloned(),
        state_at: touch.get("state").cloned(),
    }
}
