//! AC19: an outbound run for an `in_progress` task issues no state write,
//! and a following no-op run issues zero outbound writes. AC20: a remote
//! close arriving for an `in_progress` task resolves to `done` in the same
//! run, and the report records the replacement.

use std::sync::Arc;

use axum::extract::Json;
use serde_json::json;

use crate::github_port::IssueState;
use crate::todos_github::fake_github::FakeGitHub;
use crate::todos_github::routes::sync;
use crate::todos_github::run_test_support::{insert_pair, insert_todo, issue, link_project};
use crate::todos_github::test_support;

use super::{read, todo_field, writes_happened};

#[tokio::test]
async fn ac19_an_in_progress_task_with_no_remote_change_issues_zero_outbound_writes() {
    let fake = Arc::new(FakeGitHub::default().with_issue(issue(
        10,
        "Title",
        "Body",
        IssueState::Open,
        &[],
    )));
    let h = test_support::setup(fake.clone()).await;
    link_project(&h.ctx, "p-ac19").await;
    insert_todo(&h.ctx, "t1", "p-ac19", "Title", "Body", "in_progress", &[]).await;
    insert_pair(
        &h.ctx,
        "t1",
        "p-ac19",
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
            Json(json!({ "projectId": "p-ac19" })),
        )
        .await,
    )
    .await;
    assert!(
        !writes_happened(&fake),
        "the first run must not close the issue for an in_progress task"
    );

    read(
        sync::post_sync(
            test_support::state(&h),
            Json(json!({ "projectId": "p-ac19" })),
        )
        .await,
    )
    .await;
    assert!(
        !writes_happened(&fake),
        "a following no-op run must issue zero outbound writes"
    );
}

#[tokio::test]
async fn ac20_a_remote_close_for_an_in_progress_task_resolves_to_done_with_no_outbound_write() {
    let fake = Arc::new(FakeGitHub::default().with_issue(issue(
        10,
        "Title",
        "Body",
        IssueState::Closed,
        &[],
    )));
    let h = test_support::setup(fake.clone()).await;
    link_project(&h.ctx, "p-ac20").await;
    insert_todo(&h.ctx, "t1", "p-ac20", "Title", "Body", "in_progress", &[]).await;
    insert_pair(
        &h.ctx,
        "t1",
        "p-ac20",
        10,
        "2026-01-01T00:00:00Z",
        "Title",
        "Body",
        "open",
        &[],
    )
    .await;

    let (_, sync_body) = read(
        sync::post_sync(
            test_support::state(&h),
            Json(json!({ "projectId": "p-ac20" })),
        )
        .await,
    )
    .await;
    let run_id = sync_body["run"]["runId"].as_str().unwrap().to_string();

    assert_eq!(
        todo_field(&h.ctx, "t1", "status").await.as_deref(),
        Some("done")
    );
    assert!(!writes_happened(&fake));

    let (_, report_body) = read(
        sync::get_report(
            test_support::state(&h),
            super::qs(&[("projectId", "p-ac20"), ("runId", &run_id)]),
        )
        .await,
    )
    .await;
    let row = &report_body["report"]["rows"][0];
    assert_eq!(row["field"], json!("state"));
    assert_eq!(row["rule"], json!("in-progress-close"));
    assert_eq!(row["winner"], json!("github"));
}
