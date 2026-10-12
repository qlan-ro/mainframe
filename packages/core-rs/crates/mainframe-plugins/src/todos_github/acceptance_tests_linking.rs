//! AC1: unlinking a pair leaves both sides byte-identical.

use std::sync::Arc;

use axum::extract::Path;
use axum::http::StatusCode;

use crate::github_port::IssueState;
use crate::todos_github::fake_github::FakeGitHub;
use crate::todos_github::routes::pairs;
use crate::todos_github::run_test_support::{insert_pair, insert_todo, issue, link_project};
use crate::todos_github::test_support;

use super::{read, todo_field};

#[tokio::test]
async fn ac1_unlinking_a_pair_leaves_the_task_and_issue_byte_identical() {
    let fake = Arc::new(FakeGitHub::default().with_issue(issue(
        10,
        "Fix crash",
        "Steps to reproduce",
        IssueState::Open,
        &["bug"],
    )));
    let h = test_support::setup(fake.clone()).await;
    link_project(&h.ctx, "p-ac1").await;
    insert_todo(
        &h.ctx,
        "t1",
        "p-ac1",
        "Fix crash",
        "Steps to reproduce",
        "open",
        &["bug"],
    )
    .await;
    insert_pair(
        &h.ctx,
        "t1",
        "p-ac1",
        10,
        "2026-01-01T00:00:00Z",
        "Fix crash",
        "Steps to reproduce",
        "open",
        &["bug"],
    )
    .await;

    let (status, _) =
        read(pairs::delete_pair(test_support::state(&h), Path("t1".to_string())).await).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    assert_eq!(
        todo_field(&h.ctx, "t1", "title").await.as_deref(),
        Some("Fix crash")
    );
    assert_eq!(
        todo_field(&h.ctx, "t1", "body").await.as_deref(),
        Some("Steps to reproduce")
    );
    assert_eq!(
        fake.call_count(),
        0,
        "unlinking must never touch GitHub, so the issue stays byte-identical too"
    );
}
