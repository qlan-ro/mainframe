//! Publishing an existing local task as a new GitHub issue (AC6).

use mainframe_types::time::now_iso8601;

use crate::PluginError;
use crate::context::PluginContext;
use crate::github_port::{GitHubPortError, IssuePatch, IssueSnapshot, IssueState, RepoRef};
use crate::todos::types::Todo;
use crate::todos_github::store::{Pair, PairState};

/// Two calls when closing, since `CreateIssue` has no state field: create as
/// open, then patch to closed with the "completed" reason.
pub(super) async fn close_as_completed(
    ctx: &PluginContext,
    repo: &RepoRef,
    credential_label: &str,
    issue_number: u64,
) -> Result<IssueSnapshot, GitHubPortError> {
    let patch = IssuePatch {
        state: Some(IssueState::Closed),
        state_reason: Some("completed".to_string()),
        ..Default::default()
    };
    ctx.github
        .update_issue(repo, issue_number, patch, credential_label)
        .await
}

pub(super) fn build_published_pair(
    project_id: &str,
    repo: &RepoRef,
    issue: &IssueSnapshot,
    todo: Todo,
    labels: Vec<String>,
    closing: bool,
) -> Result<Pair, PluginError> {
    let now = now_iso8601();
    Ok(Pair {
        todo_id: todo.id,
        project_id: project_id.to_string(),
        owner: repo.owner.clone(),
        repo: repo.repo.clone(),
        issue_number: i64::try_from(issue.number)
            .map_err(|_| PluginError::Invariant("GitHub issue number out of range"))?,
        issue_url: issue.html_url.clone(),
        pair_state: PairState::Clean,
        state_reason: None,
        base_title: todo.title,
        base_body: todo.body,
        base_state: if closing { "closed" } else { "open" }.to_string(),
        base_labels: labels,
        base_at: now.clone(),
        created_at: now,
    })
}
