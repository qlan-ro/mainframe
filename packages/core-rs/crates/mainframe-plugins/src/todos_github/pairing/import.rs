//! Importing a selected GitHub issue as a new local task (AC3, AC5).
//! The caller in `mod.rs` turns an [`ImportError`] into a `Skipped` row whose
//! reason is the error's text, rather than failing the whole batch.

use mainframe_types::time::now_iso8601;

use crate::PluginError;
use crate::context::PluginContext;
use crate::github_port::{GitHubPortError, RepoRef};
use crate::todos::input::CreateTodo;
use crate::todos::repo;
use crate::todos_github::labels::syncable_labels;
use crate::todos_github::store::{self, Pair, PairState};

use super::Imported;

/// Why one issue could not be imported. The text becomes the `Skipped`
/// row's reason.
#[derive(Debug, thiserror::Error)]
pub(super) enum ImportError {
    #[error(transparent)]
    GitHub(#[from] GitHubPortError),
    #[error(transparent)]
    Store(#[from] PluginError),
}

/// Creates the task and its pair in one transaction, so a pair that cannot
/// be written (the issue was imported concurrently) leaves no task behind.
pub(super) async fn import_one(
    ctx: &PluginContext,
    project_id: &str,
    credential_label: &str,
    repo: &RepoRef,
    issue_number: i64,
) -> Result<Imported, ImportError> {
    let issue = ctx
        .github
        // `import_issues` passes only positive numbers, so this is exact.
        .get_issue(repo, issue_number.unsigned_abs(), credential_label)
        .await?;
    let labels = syncable_labels(&issue.labels);
    let now = now_iso8601();
    let todo_id = nanoid::nanoid!();
    let todo = CreateTodo {
        project_id: project_id.to_string(),
        title: issue.title.clone(),
        body: issue.body.clone(),
        labels: labels.clone(),
        ..Default::default()
    };
    let pair = Pair {
        todo_id: todo_id.clone(),
        project_id: project_id.to_string(),
        owner: repo.owner.clone(),
        repo: repo.repo.clone(),
        issue_number,
        issue_url: issue.html_url,
        pair_state: PairState::Clean,
        state_reason: None,
        base_title: issue.title,
        base_body: issue.body,
        base_state: "open".to_string(),
        base_labels: labels,
        base_at: now.clone(),
        created_at: now,
    };
    let todo_number = ctx
        .db()?
        .call_mut(move |db| {
            let transaction = db.transaction()?;
            let number = repo::insert_row(&transaction, &pair.todo_id, &todo, &pair.created_at)?;
            store::insert_pair_in(&transaction, &pair)?;
            transaction.commit()?;
            Ok(number)
        })
        .await?;

    Ok(Imported {
        issue_number,
        todo_id,
        todo_number,
    })
}
