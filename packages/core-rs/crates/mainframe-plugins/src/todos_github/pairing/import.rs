//! Importing a selected GitHub issue as a new local task (AC3, AC5).
//! The caller in `mod.rs` turns an [`ImportError`] into a `Skipped` row whose
//! reason is the error's text, rather than failing the whole batch.

use mainframe_types::time::now_iso8601;

use crate::PluginError;
use crate::context::PluginContext;
use crate::db_context::text;
use crate::github_port::{GitHubPortError, RepoRef};
use crate::todos_github::labels::syncable_labels;
use crate::todos_github::store;

use super::Imported;
use super::fetch::fetch_todo_number;

/// Why one issue could not be imported. The text becomes the `Skipped`
/// row's reason.
#[derive(Debug, thiserror::Error)]
pub(super) enum ImportError {
    #[error(transparent)]
    GitHub(#[from] GitHubPortError),
    #[error(transparent)]
    Store(#[from] PluginError),
}

pub(super) async fn import_one(
    ctx: &PluginContext,
    project_id: &str,
    credential_label: &str,
    repo: &RepoRef,
    issue_number: i64,
) -> Result<Imported, ImportError> {
    let issue = ctx
        .github
        .get_issue(repo, issue_number as u64, credential_label)
        .await?;
    let labels = syncable_labels(&issue.labels);
    let now = now_iso8601();
    let todo_id = nanoid::nanoid!();
    let todo_number = insert_local_todo(
        ctx,
        &todo_id,
        project_id,
        &issue.title,
        &issue.body,
        &labels,
        &now,
    )
    .await?;

    store::insert_pair(
        ctx,
        &store::Pair {
            todo_id: todo_id.clone(),
            project_id: project_id.to_string(),
            owner: repo.owner.clone(),
            repo: repo.repo.clone(),
            issue_number,
            issue_url: issue.html_url.clone(),
            pair_state: "clean".to_string(),
            state_reason: None,
            base_title: issue.title.clone(),
            base_body: issue.body.clone(),
            base_state: "open".to_string(),
            base_labels: labels,
            base_at: now.clone(),
            created_at: now,
        },
    )
    .await?;

    Ok(Imported {
        issue_number,
        todo_id,
        todo_number,
    })
}

async fn insert_local_todo(
    ctx: &PluginContext,
    todo_id: &str,
    project_id: &str,
    title: &str,
    body: &str,
    labels: &[String],
    at: &str,
) -> Result<i64, PluginError> {
    ctx.db
        .execute(
            "INSERT INTO todos (id, number, project_id, title, body, status, labels, created_at, updated_at)
             VALUES (?, (SELECT COALESCE(MAX(number), 0) + 1 FROM todos WHERE project_id = ?), ?, ?, ?, 'open', ?, ?, ?)"
                .into(),
            vec![
                text(todo_id.to_string()),
                text(project_id.to_string()),
                text(project_id.to_string()),
                text(title.to_string()),
                text(body.to_string()),
                text(serde_json::to_string(labels).unwrap_or_else(|_| "[]".to_string())),
                text(at.to_string()),
                text(at.to_string()),
            ],
        )
        .await?;
    Ok(fetch_todo_number(ctx, todo_id).await?.unwrap_or(0))
}
