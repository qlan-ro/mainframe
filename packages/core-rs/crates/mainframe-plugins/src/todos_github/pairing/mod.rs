//! Explicit todo↔issue pairing: `list_remote_issues` lists open
//! issues annotated with their local pairing, `import_issues` creates one
//! task per selected issue, and `publish_task` creates an issue from an
//! existing task. Neither stamps the touch map (`touch::stamp_*`) — the
//! baseline written here already matches the content verbatim, so there is
//! nothing for the next sync run to mistake for a local edit.

mod import;
mod publish;

use crate::PluginError;
use crate::context::PluginContext;
use crate::github_port::{CreateIssue, GitHubPortError, RepoRef};
use crate::todos::repo;
use crate::todos::types::TodoStatus;
use crate::todos_github::labels::syncable_labels;
use crate::todos_github::store;

#[derive(Debug, Clone, PartialEq)]
pub struct RemoteIssue {
    pub number: i64,
    pub title: String,
    pub labels: Vec<String>,
    pub paired_todo_number: Option<i64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Imported {
    pub issue_number: i64,
    pub todo_id: String,
    pub todo_number: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Skipped {
    pub issue_number: i64,
    pub reason: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ImportResult {
    pub imported: Vec<Imported>,
    pub skipped: Vec<Skipped>,
}

#[derive(Debug)]
pub enum PairingError {
    NotLinked,
    TodoNotFound,
    AlreadyPaired,
    /// A classified GitHub-port failure (auth, rate limit, network, ...) —
    /// kept as the original `GitHubPortError` rather than flattened into
    /// `Failed` so the route layer can map it to a status other than 500,
    /// the same way `run/mod.rs`'s `handle_port_error` does for sync runs.
    Port(GitHubPortError),
    Failed(PluginError),
}

impl From<PluginError> for PairingError {
    fn from(err: PluginError) -> Self {
        PairingError::Failed(err)
    }
}

fn port_err(err: GitHubPortError) -> PairingError {
    PairingError::Port(err)
}

fn linked_repo(link: &store::Link) -> RepoRef {
    RepoRef {
        owner: link.owner.clone(),
        repo: link.repo.clone(),
    }
}

pub(crate) async fn list_remote_issues(
    ctx: &PluginContext,
    project_id: &str,
) -> Result<Vec<RemoteIssue>, PairingError> {
    let link = store::read_link(ctx, project_id)
        .await?
        .ok_or(PairingError::NotLinked)?;
    let issues = ctx
        .github
        .list_open_issues(&linked_repo(&link), &link.credential_label)
        .await
        .map_err(port_err)?;
    let paired = store::paired_todo_numbers(ctx, project_id, &link.owner, &link.repo).await?;

    let mut out = Vec::with_capacity(issues.len());
    for issue in issues {
        let number = i64::try_from(issue.number)
            .map_err(|_| PluginError::Invariant("GitHub issue number out of range"))?;
        out.push(RemoteIssue {
            number,
            title: issue.title,
            labels: issue.labels,
            paired_todo_number: paired.get(&number).copied(),
        });
    }
    Ok(out)
}

/// Skips (rather than fails) a non-positive number, an issue already paired,
/// or one the port couldn't fetch, so one bad number never blocks the rest of
/// the batch.
pub(crate) async fn import_issues(
    ctx: &PluginContext,
    project_id: &str,
    issue_numbers: &[i64],
) -> Result<ImportResult, PairingError> {
    let link = store::read_link(ctx, project_id)
        .await?
        .ok_or(PairingError::NotLinked)?;
    let repo = linked_repo(&link);

    let mut result = ImportResult::default();
    for &issue_number in issue_numbers {
        if issue_number <= 0 {
            result.skipped.push(Skipped {
                issue_number,
                reason: "not an issue number".to_string(),
            });
            continue;
        }
        let existing =
            store::read_pair_by_issue(ctx, project_id, &link.owner, &link.repo, issue_number)
                .await?;
        if existing.is_some() {
            result.skipped.push(Skipped {
                issue_number,
                reason: "already imported".to_string(),
            });
            continue;
        }
        match import::import_one(ctx, project_id, &link.credential_label, &repo, issue_number).await
        {
            Ok(imported) => result.imported.push(imported),
            Err(err) => result.skipped.push(Skipped {
                issue_number,
                reason: err.to_string(),
            }),
        }
    }
    Ok(result)
}

/// Refuses an already-paired task before making any GitHub call. A `done`
/// task publishes as an open issue, then closes it as completed — the create
/// DTO has no state field, so this always costs two calls when closing.
pub(crate) async fn publish_task(
    ctx: &PluginContext,
    project_id: &str,
    todo_id: &str,
) -> Result<store::Pair, PairingError> {
    let link = store::read_link(ctx, project_id)
        .await?
        .ok_or(PairingError::NotLinked)?;
    if store::read_pair_by_todo(ctx, todo_id).await?.is_some() {
        return Err(PairingError::AlreadyPaired);
    }
    let todo = repo::fetch(ctx, todo_id)
        .await?
        .ok_or(PairingError::TodoNotFound)?;
    let repo = linked_repo(&link);
    let labels = syncable_labels(&todo.labels);
    let closing = todo.status == TodoStatus::Done;

    let create = CreateIssue {
        title: todo.title.clone(),
        body: todo.body.clone(),
        labels: labels.clone(),
    };
    let mut issue = ctx
        .github
        .create_issue(&repo, create, &link.credential_label)
        .await
        .map_err(port_err)?;
    if closing {
        issue = publish::close_as_completed(ctx, &repo, &link.credential_label, issue.number)
            .await
            .map_err(port_err)?;
    }

    let pair = publish::build_published_pair(project_id, &repo, &issue, todo, labels, closing)?;
    store::insert_pair(ctx, &pair).await?;
    Ok(pair)
}
