//! Fixture builders shared by `run_tests.rs`: a linked project, a paired
//! todo/issue at a chosen baseline, and a bare `IssueSnapshot`.

use crate::PluginContext;
use crate::db_context::text;
use crate::github_port::{IssueSnapshot, IssueState};
use crate::todos_github::store::{self, Link, Pair};

pub(super) const OWNER: &str = "acme";
pub(super) const REPO: &str = "widgets";
pub(super) const CREDENTIAL: &str = "acme-widgets-cred";

pub(super) async fn insert_todo(
    ctx: &PluginContext,
    id: &str,
    project_id: &str,
    title: &str,
    body: &str,
    status: &str,
    labels: &[&str],
) {
    ctx.db
        .execute(
            "INSERT INTO todos (id, number, project_id, title, body, status, labels, created_at, updated_at)
             VALUES (?, 1, ?, ?, ?, ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"
                .into(),
            vec![
                text(id.to_string()),
                text(project_id.to_string()),
                text(title.to_string()),
                text(body.to_string()),
                text(status.to_string()),
                text(labels_json(labels)),
            ],
        )
        .await
        .unwrap();
}

pub(super) async fn link_project(ctx: &PluginContext, project_id: &str) {
    store::insert_link(
        ctx,
        &Link {
            project_id: project_id.to_string(),
            owner: OWNER.to_string(),
            repo: REPO.to_string(),
            remote_name: "origin".to_string(),
            credential_label: CREDENTIAL.to_string(),
            last_synced_at: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
        },
    )
    .await
    .unwrap();
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn insert_pair(
    ctx: &PluginContext,
    todo_id: &str,
    project_id: &str,
    issue_number: i64,
    created_at: &str,
    base_title: &str,
    base_body: &str,
    base_state: &str,
    base_labels: &[&str],
) {
    store::insert_pair(
        ctx,
        &Pair {
            todo_id: todo_id.to_string(),
            project_id: project_id.to_string(),
            owner: OWNER.to_string(),
            repo: REPO.to_string(),
            issue_number,
            issue_url: format!("https://github.com/{OWNER}/{REPO}/issues/{issue_number}"),
            pair_state: "clean".to_string(),
            state_reason: None,
            base_title: base_title.to_string(),
            base_body: base_body.to_string(),
            base_state: base_state.to_string(),
            base_labels: base_labels.iter().map(|s| s.to_string()).collect(),
            base_at: "2026-01-01T00:00:00Z".to_string(),
            created_at: created_at.to_string(),
        },
    )
    .await
    .unwrap();
}

pub(super) fn issue(
    number: u64,
    title: &str,
    body: &str,
    state: IssueState,
    labels: &[&str],
) -> IssueSnapshot {
    IssueSnapshot {
        number,
        title: title.to_string(),
        body: body.to_string(),
        labels: labels.iter().map(|s| s.to_string()).collect(),
        state,
        html_url: format!("https://github.com/{OWNER}/{REPO}/issues/{number}"),
        updated_at: "2026-01-01T00:00:00Z".to_string(),
    }
}

async fn todo_row_str(ctx: &PluginContext, id: &str, column: &str) -> String {
    ctx.db
        .query_one(
            format!("SELECT {column} FROM todos WHERE id = ?"),
            vec![text(id.to_string())],
        )
        .await
        .unwrap()
        .and_then(|row| row.get(column).and_then(|v| v.as_str().map(str::to_string)))
        .unwrap_or_default()
}

pub(super) async fn todo_title(ctx: &PluginContext, id: &str) -> String {
    todo_row_str(ctx, id, "title").await
}

fn labels_json(labels: &[&str]) -> String {
    serde_json::to_string(&labels.iter().map(|s| s.to_string()).collect::<Vec<_>>()).unwrap()
}

pub(super) async fn run_count(ctx: &PluginContext, project_id: &str) -> i64 {
    ctx.db
        .query_one(
            "SELECT COUNT(*) as n FROM github_runs WHERE project_id = ?".into(),
            vec![text(project_id.to_string())],
        )
        .await
        .unwrap()
        .and_then(|row| row.get("n").and_then(|v| v.as_i64()))
        .unwrap_or(0)
}
