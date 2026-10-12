//! AC18, remote directions: a remote close sets the task to `done`, and a
//! remote reopen sets a `done` task to `open`.

use std::sync::Arc;

use axum::extract::Json;
use serde_json::json;

use crate::github_port::IssueState;
use crate::todos_github::fake_github::FakeGitHub;
use crate::todos_github::routes::sync;
use crate::todos_github::run_test_support::{insert_pair, insert_todo, issue, link_project};
use crate::todos_github::test_support;

use super::{read, todo_field};

#[tokio::test]
async fn ac18_a_remote_close_sets_the_task_to_done() {
    let fake = Arc::new(FakeGitHub::default().with_issue(issue(
        10,
        "Title",
        "Body",
        IssueState::Closed,
        &[],
    )));
    let h = test_support::setup(fake).await;
    link_project(&h.ctx, "p-ac18-remote-close").await;
    insert_todo(
        &h.ctx,
        "t1",
        "p-ac18-remote-close",
        "Title",
        "Body",
        "open",
        &[],
    )
    .await;
    insert_pair(
        &h.ctx,
        "t1",
        "p-ac18-remote-close",
        10,
        "2026-01-01T00:00:00Z",
        "Title",
        "Body",
        "open",
        &[],
    )
    .await;

    read(
        sync::post_sync(
            test_support::state(&h),
            Json(json!({ "projectId": "p-ac18-remote-close" })),
        )
        .await,
    )
    .await;

    assert_eq!(
        todo_field(&h.ctx, "t1", "status").await.as_deref(),
        Some("done")
    );
}

#[tokio::test]
async fn ac18_a_remote_reopen_sets_a_done_task_to_open() {
    let fake = Arc::new(FakeGitHub::default().with_issue(issue(
        10,
        "Title",
        "Body",
        IssueState::Open,
        &[],
    )));
    let h = test_support::setup(fake).await;
    link_project(&h.ctx, "p-ac18-remote-reopen").await;
    insert_todo(
        &h.ctx,
        "t1",
        "p-ac18-remote-reopen",
        "Title",
        "Body",
        "done",
        &[],
    )
    .await;
    insert_pair(
        &h.ctx,
        "t1",
        "p-ac18-remote-reopen",
        10,
        "2026-01-01T00:00:00Z",
        "Title",
        "Body",
        "closed",
        &[],
    )
    .await;

    read(
        sync::post_sync(
            test_support::state(&h),
            Json(json!({ "projectId": "p-ac18-remote-reopen" })),
        )
        .await,
    )
    .await;

    assert_eq!(
        todo_field(&h.ctx, "t1", "status").await.as_deref(),
        Some("open")
    );
}
