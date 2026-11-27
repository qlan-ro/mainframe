//! Writes that span several tables commit together: a failure part-way
//! through leaves none of them behind. A trigger that aborts the last insert
//! stands in for the failure.

use std::sync::Arc;

use axum::extract::Json;
use axum::http::StatusCode;
use serde_json::json;

use crate::PluginContext;
use crate::db_context::test_sql::{RawSql as _, text};
use crate::github_port::IssueState;
use crate::todos;
use crate::todos::routes::post_todo;
use crate::todos_github::fake_github::FakeGitHub;
use crate::todos_github::pairing;
use crate::todos_github::run_test_support::{issue, link_project};
use crate::todos_github::test_support::setup;

async fn fail_inserts_into(ctx: &PluginContext, table: &str) {
    ctx.raw_execute(
        &format!(
            "CREATE TRIGGER fail_{table} BEFORE INSERT ON {table}
             BEGIN SELECT RAISE(ABORT, 'injected failure'); END"
        ),
        vec![],
    )
    .await
    .unwrap();
}

async fn todo_count(ctx: &PluginContext, project_id: &str) -> i64 {
    ctx.raw_query_one(
        "SELECT COUNT(*) AS n FROM todos WHERE project_id = ?",
        vec![text(project_id)],
    )
    .await
    .unwrap()
    .and_then(|row| row["n"].as_i64())
    .unwrap()
}

#[tokio::test]
async fn an_import_whose_pair_cannot_be_written_leaves_no_task() {
    let fake = Arc::new(FakeGitHub::default().with_issue(issue(
        10,
        "Title",
        "Body",
        IssueState::Open,
        &[],
    )));
    let harness = setup(fake).await;
    let ctx = &harness.ctx;
    link_project(ctx, "p1").await;
    fail_inserts_into(ctx, "github_pairs").await;

    let result = pairing::import_issues(ctx, "p1", &[10]).await.unwrap();

    assert!(result.imported.is_empty());
    assert_eq!(result.skipped.len(), 1);
    assert_eq!(todo_count(ctx, "p1").await, 0);
}

#[tokio::test]
async fn a_created_task_whose_touch_stamps_fail_is_not_kept() {
    let h = todos::tests::setup().await;
    fail_inserts_into(&h.ctx, "github_touch").await;

    let response = post_todo(
        todos::tests::state(&h),
        Json(json!({ "projectId": "p1", "title": "T" })),
    )
    .await;

    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(todo_count(&h.ctx, "p1").await, 0);
}

#[tokio::test]
async fn non_positive_issue_numbers_are_skipped_without_a_github_call() {
    let fake = Arc::new(FakeGitHub::default());
    let harness = setup(fake.clone()).await;
    let ctx = &harness.ctx;
    link_project(ctx, "p1").await;

    let result = pairing::import_issues(ctx, "p1", &[0, -3]).await.unwrap();

    assert_eq!(result.skipped.len(), 2);
    assert!(fake.calls.lock().unwrap().is_empty());
}
