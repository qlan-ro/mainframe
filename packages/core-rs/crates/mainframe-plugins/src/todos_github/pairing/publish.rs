//! Task 17: publishing an existing local task as a new GitHub issue (AC6).

use mainframe_runtime::time::now_iso8601;
use serde_json::Value;

use crate::PluginError;
use crate::context::PluginContext;
use crate::db_context::{Row, text};
use crate::github_port::{GitHubPortError, IssuePatch, IssueSnapshot, IssueState, RepoRef};
use crate::todos::safe_json_array;
use crate::todos_github::store;

pub(super) struct LocalTodo {
    pub(super) title: String,
    pub(super) body: String,
    pub(super) status: String,
    pub(super) labels: Vec<String>,
}

pub(super) async fn fetch_local_todo(
    ctx: &PluginContext,
    todo_id: &str,
) -> Result<Option<LocalTodo>, PluginError> {
    let row = ctx
        .db
        .query_one(
            "SELECT title, body, status, labels FROM todos WHERE id = ?".into(),
            vec![text(todo_id.to_string())],
        )
        .await?;
    Ok(row.map(|row| {
        let labels_raw = row.get("labels").and_then(Value::as_str).unwrap_or("");
        let labels = safe_json_array(labels_raw, "labels", todo_id)
            .into_iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect();
        LocalTodo {
            title: col(&row, "title"),
            body: col(&row, "body"),
            status: col(&row, "status"),
            labels,
        }
    }))
}

fn col(row: &Row, key: &str) -> String {
    row.get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

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

#[allow(clippy::too_many_arguments)]
pub(super) fn build_published_pair(
    todo_id: &str,
    project_id: &str,
    repo: &RepoRef,
    issue: &IssueSnapshot,
    todo: LocalTodo,
    labels: Vec<String>,
    closing: bool,
) -> store::Pair {
    let now = now_iso8601();
    store::Pair {
        todo_id: todo_id.to_string(),
        project_id: project_id.to_string(),
        owner: repo.owner.clone(),
        repo: repo.repo.clone(),
        issue_number: issue.number as i64,
        issue_url: issue.html_url.clone(),
        pair_state: "clean".to_string(),
        state_reason: None,
        base_title: todo.title,
        base_body: todo.body,
        base_state: if closing { "closed" } else { "open" }.to_string(),
        base_labels: labels,
        base_at: now.clone(),
        created_at: now,
    }
}
