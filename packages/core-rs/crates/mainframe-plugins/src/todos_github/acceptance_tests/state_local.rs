//! AC18, local directions: moving a task to `done` closes the issue as
//! completed; moving it off `done` reopens it.

use std::sync::Arc;

use axum::extract::{Json, Path};
use serde_json::json;

use crate::github_port::{IssueState, IssueState::Closed, IssueState::Open};
use crate::todos::move_todo;
use crate::todos_github::fake_github::FakeGitHub;
use crate::todos_github::routes::sync;
use crate::todos_github::run_test_support::{insert_pair, insert_todo, issue, link_project};
use crate::todos_github::test_support;

use super::{read, update_patch};

#[tokio::test]
async fn ac18_moving_a_task_to_done_closes_the_issue_as_completed() {
    let fake = Arc::new(FakeGitHub::default().with_issue(issue(
        10,
        "Title",
        "Body",
        IssueState::Open,
        &[],
    )));
    let h = test_support::setup(fake.clone()).await;
    link_project(&h.ctx, "p-ac18-close").await;
    insert_todo(&h.ctx, "t1", "p-ac18-close", "Title", "Body", "open", &[]).await;
    insert_pair(
        &h.ctx,
        "t1",
        "p-ac18-close",
        10,
        "2026-01-01T00:00:00Z",
        "Title",
        "Body",
        "open",
        &[],
    )
    .await;

    read(
        move_todo(
            test_support::state(&h),
            Path("t1".to_string()),
            Json(json!({ "status": "done" })),
        )
        .await,
    )
    .await;
    read(
        sync::post_sync(
            test_support::state(&h),
            Json(json!({ "projectId": "p-ac18-close" })),
        )
        .await,
    )
    .await;

    let patch = update_patch(&fake, 10);
    assert_eq!(patch.state, Some(Closed));
    assert_eq!(patch.state_reason.as_deref(), Some("completed"));
}

#[tokio::test]
async fn ac18_moving_a_task_off_done_reopens_the_issue() {
    let fake = Arc::new(FakeGitHub::default().with_issue(issue(
        10,
        "Title",
        "Body",
        IssueState::Closed,
        &[],
    )));
    let h = test_support::setup(fake.clone()).await;
    link_project(&h.ctx, "p-ac18-reopen").await;
    insert_todo(&h.ctx, "t1", "p-ac18-reopen", "Title", "Body", "done", &[]).await;
    insert_pair(
        &h.ctx,
        "t1",
        "p-ac18-reopen",
        10,
        "2026-01-01T00:00:00Z",
        "Title",
        "Body",
        "closed",
        &[],
    )
    .await;

    read(
        move_todo(
            test_support::state(&h),
            Path("t1".to_string()),
            Json(json!({ "status": "open" })),
        )
        .await,
    )
    .await;
    read(
        sync::post_sync(
            test_support::state(&h),
            Json(json!({ "projectId": "p-ac18-reopen" })),
        )
        .await,
    )
    .await;

    let patch = update_patch(&fake, 10);
    assert_eq!(patch.state, Some(Open));
    assert_eq!(patch.state_reason, None);
}
