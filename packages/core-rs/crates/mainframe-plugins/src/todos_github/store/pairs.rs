//! `github_pairs` — one row per todo↔issue pairing, keyed on `todo_id` (never
//! `number`, which the board reuses after a delete — fact 5). Carries the
//! 3-way-diff baseline (`base_*`) and the `pair_state` shown in the UI.

use crate::PluginError;
use crate::context::PluginContext;
use crate::db_context::{Row, int, nullable_text, text};
use crate::todos::safe_json_array;

use super::{col_i64, col_opt_str, col_str};

#[derive(Debug, Clone, PartialEq)]
pub struct Pair {
    pub todo_id: String,
    pub project_id: String,
    pub owner: String,
    pub repo: String,
    pub issue_number: i64,
    pub issue_url: String,
    pub pair_state: String,
    pub state_reason: Option<String>,
    pub base_title: String,
    pub base_body: String,
    pub base_state: String,
    pub base_labels: Vec<String>,
    pub base_at: String,
    pub created_at: String,
}

/// Rejects a duplicate `(project_id, owner, repo, issue_number)` via the
/// schema's `UNIQUE` index (AC4) — one issue pairs to at most one todo.
pub async fn insert_pair(ctx: &PluginContext, pair: &Pair) -> Result<(), PluginError> {
    ctx.db
        .execute(
            "INSERT INTO github_pairs
               (todo_id, project_id, owner, repo, issue_number, issue_url, pair_state, state_reason,
                base_title, base_body, base_state, base_labels, base_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                .into(),
            vec![
                text(pair.todo_id.clone()),
                text(pair.project_id.clone()),
                text(pair.owner.clone()),
                text(pair.repo.clone()),
                int(pair.issue_number),
                text(pair.issue_url.clone()),
                text(pair.pair_state.clone()),
                nullable_text(pair.state_reason.clone()),
                text(pair.base_title.clone()),
                text(pair.base_body.clone()),
                text(pair.base_state.clone()),
                text(labels_json(&pair.base_labels)),
                text(pair.base_at.clone()),
                text(pair.created_at.clone()),
            ],
        )
        .await
}

pub async fn read_pair_by_todo(
    ctx: &PluginContext,
    todo_id: &str,
) -> Result<Option<Pair>, PluginError> {
    let row = ctx
        .db
        .query_one(
            "SELECT * FROM github_pairs WHERE todo_id = ?".into(),
            vec![text(todo_id.to_string())],
        )
        .await?;
    Ok(row.map(row_to_pair))
}

pub async fn read_pair_by_issue(
    ctx: &PluginContext,
    project_id: &str,
    owner: &str,
    repo: &str,
    issue_number: i64,
) -> Result<Option<Pair>, PluginError> {
    let row = ctx
        .db
        .query_one(
            "SELECT * FROM github_pairs WHERE project_id = ? AND owner = ? AND repo = ? AND issue_number = ?"
                .into(),
            vec![
                text(project_id.to_string()),
                text(owner.to_string()),
                text(repo.to_string()),
                int(issue_number),
            ],
        )
        .await?;
    Ok(row.map(row_to_pair))
}

/// Every pair still eligible for reconciliation, oldest first. A
/// `remotely-unlinked` pair is excluded so a following run never re-fetches a
/// pairing already known to be broken (AC25).
pub async fn pairs_for_project(
    ctx: &PluginContext,
    project_id: &str,
) -> Result<Vec<Pair>, PluginError> {
    let rows = ctx
        .db
        .query_all(
            "SELECT * FROM github_pairs WHERE project_id = ? AND pair_state != 'remotely-unlinked'
             ORDER BY created_at, todo_id"
                .into(),
            vec![text(project_id.to_string())],
        )
        .await?;
    Ok(rows.into_iter().map(row_to_pair).collect())
}

/// Overwrites the 3-way-diff baseline after a run reconciles this pair.
pub async fn write_baseline(
    ctx: &PluginContext,
    todo_id: &str,
    title: &str,
    body: &str,
    state: &str,
    labels: &[String],
    at: &str,
) -> Result<(), PluginError> {
    ctx.db
        .execute(
            "UPDATE github_pairs SET base_title = ?, base_body = ?, base_state = ?, base_labels = ?, base_at = ?
             WHERE todo_id = ?"
                .into(),
            vec![
                text(title.to_string()),
                text(body.to_string()),
                text(state.to_string()),
                text(labels_json(labels)),
                text(at.to_string()),
                text(todo_id.to_string()),
            ],
        )
        .await
}

pub async fn set_pair_state(
    ctx: &PluginContext,
    todo_id: &str,
    state: &str,
    reason: Option<&str>,
) -> Result<(), PluginError> {
    ctx.db
        .execute(
            "UPDATE github_pairs SET pair_state = ?, state_reason = ? WHERE todo_id = ?".into(),
            vec![
                text(state.to_string()),
                nullable_text(reason.map(str::to_string)),
                text(todo_id.to_string()),
            ],
        )
        .await
}

/// The delete-todo cascade's store half (AC24) — the dispatch that calls this
/// on todo deletion lives in `todos::delete_todo` (task 11).
pub async fn delete_pair(ctx: &PluginContext, todo_id: &str) -> Result<(), PluginError> {
    ctx.db
        .execute(
            "DELETE FROM github_pairs WHERE todo_id = ?".into(),
            vec![text(todo_id.to_string())],
        )
        .await
}

fn labels_json(labels: &[String]) -> String {
    serde_json::to_string(labels).unwrap_or_else(|_| "[]".to_string())
}

fn row_to_pair(row: Row) -> Pair {
    let todo_id = col_str(&row, "todo_id");
    let raw_labels = col_str(&row, "base_labels");
    let base_labels = safe_json_array(&raw_labels, "base_labels", &todo_id)
        .into_iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect();
    Pair {
        project_id: col_str(&row, "project_id"),
        owner: col_str(&row, "owner"),
        repo: col_str(&row, "repo"),
        issue_number: col_i64(&row, "issue_number"),
        issue_url: col_str(&row, "issue_url"),
        pair_state: col_str(&row, "pair_state"),
        state_reason: col_opt_str(&row, "state_reason"),
        base_title: col_str(&row, "base_title"),
        base_body: col_str(&row, "base_body"),
        base_state: col_str(&row, "base_state"),
        base_labels,
        base_at: col_str(&row, "base_at"),
        created_at: col_str(&row, "created_at"),
        todo_id,
    }
}
