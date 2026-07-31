//! AC8: a local edit to title, body, or a syncable label reaches the issue
//! on the next run, and a remote edit to the same fields reaches the task.
//! AC17: an issue whose modification time advanced with no synced-field
//! change produces no conflict, no write, and no report entry.

use std::sync::Arc;

use axum::extract::{Json, Path};
use serde_json::json;

use crate::github_port::{IssueSnapshot, IssueState};
use crate::todos::patch_todo;
use crate::todos_github::fake_github::FakeGitHub;
use crate::todos_github::routes::sync;
use crate::todos_github::run_test_support::{insert_pair, insert_todo, issue, link_project};
use crate::todos_github::test_support;

use super::{read, todo_field, update_patch, writes_happened};

#[tokio::test]
async fn ac8_a_local_field_edit_reaches_the_issue_on_the_next_run() {
    let fake = Arc::new(FakeGitHub::default().with_issue(issue(
        10,
        "Old title",
        "Old body",
        IssueState::Open,
        &[],
    )));
    let h = test_support::setup(fake.clone()).await;
    link_project(&h.ctx, "p-ac8-local").await;
    insert_todo(
        &h.ctx,
        "t1",
        "p-ac8-local",
        "Old title",
        "Old body",
        "open",
        &[],
    )
    .await;
    insert_pair(
        &h.ctx,
        "t1",
        "p-ac8-local",
        10,
        "2026-01-01T00:00:00Z",
        "Old title",
        "Old body",
        "open",
        &[],
    )
    .await;

    read(
        patch_todo(
            test_support::state(&h),
            Path("t1".to_string()),
            Json(json!({ "title": "New title", "body": "New body", "labels": ["urgent"] })),
        )
        .await,
    )
    .await;
    read(
        sync::post_sync(
            test_support::state(&h),
            Json(json!({ "projectId": "p-ac8-local" })),
        )
        .await,
    )
    .await;

    let patch = update_patch(&fake, 10);
    assert_eq!(patch.title.as_deref(), Some("New title"));
    assert_eq!(patch.body.as_deref(), Some("New body"));
    assert_eq!(patch.labels, Some(vec!["urgent".to_string()]));
}

#[tokio::test]
async fn ac8_a_remote_field_edit_reaches_the_task() {
    let fake = Arc::new(FakeGitHub::default().with_issue(issue(
        10,
        "Remote title",
        "Remote body",
        IssueState::Open,
        &["urgent"],
    )));
    let h = test_support::setup(fake).await;
    link_project(&h.ctx, "p-ac8-remote").await;
    insert_todo(
        &h.ctx,
        "t1",
        "p-ac8-remote",
        "Old title",
        "Old body",
        "open",
        &[],
    )
    .await;
    insert_pair(
        &h.ctx,
        "t1",
        "p-ac8-remote",
        10,
        "2026-01-01T00:00:00Z",
        "Old title",
        "Old body",
        "open",
        &[],
    )
    .await;

    read(
        sync::post_sync(
            test_support::state(&h),
            Json(json!({ "projectId": "p-ac8-remote" })),
        )
        .await,
    )
    .await;

    assert_eq!(
        todo_field(&h.ctx, "t1", "title").await.as_deref(),
        Some("Remote title")
    );
    assert_eq!(
        todo_field(&h.ctx, "t1", "body").await.as_deref(),
        Some("Remote body")
    );
    let labels = todo_field(&h.ctx, "t1", "labels").await.unwrap();
    assert!(labels.contains("urgent"));
}

#[tokio::test]
async fn ac17_a_modification_time_advancing_with_no_field_change_writes_nothing() {
    let unchanged = IssueSnapshot {
        number: 10,
        title: "Title".to_string(),
        body: "Body".to_string(),
        labels: vec![],
        state: IssueState::Open,
        html_url: "https://github.com/acme/widgets/issues/10".to_string(),
        updated_at: "2026-06-01T00:00:00Z".to_string(),
    };
    let fake = Arc::new(FakeGitHub::default().with_issue(unchanged));
    let h = test_support::setup(fake.clone()).await;
    link_project(&h.ctx, "p-ac17").await;
    insert_todo(&h.ctx, "t1", "p-ac17", "Title", "Body", "open", &[]).await;
    insert_pair(
        &h.ctx,
        "t1",
        "p-ac17",
        10,
        "2026-01-01T00:00:00Z",
        "Title",
        "Body",
        "open",
        &[],
    )
    .await;

    let (_, body) = read(
        sync::post_sync(
            test_support::state(&h),
            Json(json!({ "projectId": "p-ac17" })),
        )
        .await,
    )
    .await;

    assert_eq!(body["run"]["overwrites"], json!(0));
    assert!(!writes_happened(&fake));
}
