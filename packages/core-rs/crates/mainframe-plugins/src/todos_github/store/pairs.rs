//! `github_pairs` — one row per todo↔issue pairing, keyed on `todo_id` (never
//! `number`, which the board reuses after a delete). Carries the
//! 3-way-diff baseline (`base_*`) and the `pair_state` shown in the UI.

use std::collections::HashMap;

use mainframe_db::sql_types::{FromRow, JsonCol, SqlEnum, query_all, query_opt};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

use crate::PluginError;
use crate::context::PluginContext;
use crate::todos::types::stored_string_array;
use crate::todos_github::reconcile::Baseline;

/// The outcome of a pair's most recent sync, as stored and sent to the UI.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PairState {
    /// Reconciled with nothing overwritten, or freshly paired.
    #[default]
    Clean,
    /// Reconciled, and a dispute overwrote one side.
    Overwritten,
    /// GitHub answered with an error for this pair.
    Errored,
    /// The issue is gone or moved; runs skip the pair until it is re-paired.
    RemotelyUnlinked,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Pair {
    pub todo_id: String,
    pub project_id: String,
    pub owner: String,
    pub repo: String,
    pub issue_number: i64,
    pub issue_url: String,
    pub pair_state: PairState,
    pub state_reason: Option<String>,
    pub base_title: String,
    pub base_body: String,
    pub base_state: String,
    pub base_labels: Vec<String>,
    pub base_at: String,
    pub created_at: String,
}

impl FromRow for Pair {
    type Error = PluginError;

    /// An unknown `pair_state` reads as `clean` and malformed `base_labels`
    /// as empty; both are logged.
    fn from_row(row: &rusqlite::Row<'_>) -> Result<Self, PluginError> {
        let todo_id: String = row.get("todo_id")?;
        Ok(Self {
            project_id: row.get("project_id")?,
            owner: row.get("owner")?,
            repo: row.get("repo")?,
            issue_number: row.get("issue_number")?,
            issue_url: row.get("issue_url")?,
            pair_state: SqlEnum::or_default(row.get("pair_state")?, PairState::Clean),
            state_reason: row.get("state_reason")?,
            base_title: row.get("base_title")?,
            base_body: row.get("base_body")?,
            base_state: row.get("base_state")?,
            base_labels: stored_string_array(&todo_id, "base_labels", row.get("base_labels")?),
            base_at: row.get("base_at")?,
            created_at: row.get("created_at")?,
            todo_id,
        })
    }
}

/// Rejects a duplicate `(project_id, owner, repo, issue_number)` via the
/// schema's `UNIQUE` index (AC4) — one issue pairs to at most one todo.
pub(crate) fn insert_pair_in(db: &Connection, pair: &Pair) -> rusqlite::Result<()> {
    db.execute(
        "INSERT INTO github_pairs
           (todo_id, project_id, owner, repo, issue_number, issue_url, pair_state, state_reason,
            base_title, base_body, base_state, base_labels, base_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            pair.todo_id,
            pair.project_id,
            pair.owner,
            pair.repo,
            pair.issue_number,
            pair.issue_url,
            SqlEnum(pair.pair_state),
            pair.state_reason,
            pair.base_title,
            pair.base_body,
            pair.base_state,
            JsonCol(&pair.base_labels),
            pair.base_at,
            pair.created_at,
        ],
    )?;
    Ok(())
}

pub(crate) async fn insert_pair(ctx: &PluginContext, pair: &Pair) -> Result<(), PluginError> {
    let pair = pair.clone();
    ctx.db()?
        .call(move |db| Ok(insert_pair_in(db, &pair)?))
        .await
}

pub(crate) async fn read_pair_by_todo(
    ctx: &PluginContext,
    todo_id: &str,
) -> Result<Option<Pair>, PluginError> {
    let todo_id = todo_id.to_string();
    ctx.db()?
        .call(move |db| {
            query_opt(
                db,
                "SELECT * FROM github_pairs WHERE todo_id = ?",
                [todo_id],
            )
        })
        .await
}

pub(crate) async fn read_pair_by_issue(
    ctx: &PluginContext,
    project_id: &str,
    owner: &str,
    repo: &str,
    issue_number: i64,
) -> Result<Option<Pair>, PluginError> {
    let (project_id, owner, repo) = (project_id.to_string(), owner.to_string(), repo.to_string());
    ctx.db()?
        .call(move |db| {
            query_opt(
                db,
                "SELECT * FROM github_pairs
                 WHERE project_id = ? AND owner = ? AND repo = ? AND issue_number = ?",
                params![project_id, owner, repo, issue_number],
            )
        })
        .await
}

/// Issue number → local todo number for every pair of the project against
/// `owner/repo`.
pub(crate) async fn paired_todo_numbers(
    ctx: &PluginContext,
    project_id: &str,
    owner: &str,
    repo: &str,
) -> Result<HashMap<i64, i64>, PluginError> {
    let (project_id, owner, repo) = (project_id.to_string(), owner.to_string(), repo.to_string());
    ctx.db()?
        .call(move |db| {
            let mut statement = db.prepare(
                "SELECT github_pairs.issue_number, todos.number FROM github_pairs
                 JOIN todos ON todos.id = github_pairs.todo_id
                 WHERE github_pairs.project_id = ? AND github_pairs.owner = ? AND github_pairs.repo = ?",
            )?;
            let numbers = statement
                .query_map(params![project_id, owner, repo], |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })?
                .collect::<Result<HashMap<_, _>, _>>()?;
            Ok(numbers)
        })
        .await
}

/// Every pair still eligible for reconciliation, oldest first. A
/// `remotely-unlinked` pair is excluded so a following run never re-fetches a
/// pairing already known to be broken (AC25).
pub(crate) async fn pairs_for_project(
    ctx: &PluginContext,
    project_id: &str,
) -> Result<Vec<Pair>, PluginError> {
    let project_id = project_id.to_string();
    ctx.db()?
        .call(move |db| {
            query_all(
                db,
                "SELECT * FROM github_pairs WHERE project_id = ? AND pair_state != 'remotely-unlinked'
                 ORDER BY created_at, todo_id",
                [project_id],
            )
        })
        .await
}

/// Every pair of the project, including remotely-unlinked ones, with its
/// todo's board number, oldest first.
pub(crate) async fn pairs_with_todo_numbers(
    ctx: &PluginContext,
    project_id: &str,
) -> Result<Vec<(Pair, i64)>, PluginError> {
    let project_id = project_id.to_string();
    ctx.db()?
        .call(move |db| {
            let mut statement = db.prepare(
                "SELECT github_pairs.*, todos.number AS todo_number FROM github_pairs
                 JOIN todos ON todos.id = github_pairs.todo_id
                 WHERE github_pairs.project_id = ?
                 ORDER BY github_pairs.created_at, github_pairs.todo_id",
            )?;
            let mut rows = statement.query([project_id])?;
            let mut out = Vec::new();
            while let Some(row) = rows.next()? {
                out.push((Pair::from_row(row)?, row.get("todo_number")?));
            }
            Ok(out)
        })
        .await
}

/// Overwrites the 3-way-diff baseline after a run reconciles this pair.
pub(crate) fn write_baseline_in(
    db: &Connection,
    todo_id: &str,
    baseline: &Baseline,
    at: &str,
) -> rusqlite::Result<()> {
    db.execute(
        "UPDATE github_pairs SET base_title = ?, base_body = ?, base_state = ?, base_labels = ?, base_at = ?
         WHERE todo_id = ?",
        params![
            baseline.title,
            baseline.body,
            baseline.state,
            JsonCol(&baseline.labels),
            at,
            todo_id,
        ],
    )?;
    Ok(())
}

pub(crate) fn set_pair_state_in(
    db: &Connection,
    todo_id: &str,
    state: PairState,
    reason: Option<&str>,
) -> rusqlite::Result<()> {
    db.execute(
        "UPDATE github_pairs SET pair_state = ?, state_reason = ? WHERE todo_id = ?",
        params![SqlEnum(state), reason, todo_id],
    )?;
    Ok(())
}

pub(crate) async fn set_pair_state(
    ctx: &PluginContext,
    todo_id: &str,
    state: PairState,
    reason: Option<&str>,
) -> Result<(), PluginError> {
    let todo_id = todo_id.to_string();
    let reason = reason.map(str::to_string);
    ctx.db()?
        .call(move |db| Ok(set_pair_state_in(db, &todo_id, state, reason.as_deref())?))
        .await
}

/// Unpairs one todo (AC26); the todo itself stays.
pub(crate) async fn delete_pair(ctx: &PluginContext, todo_id: &str) -> Result<(), PluginError> {
    let todo_id = todo_id.to_string();
    ctx.db()?
        .call(move |db| {
            db.execute("DELETE FROM github_pairs WHERE todo_id = ?", [todo_id])?;
            Ok(())
        })
        .await
}
