//! AC27: no workflow label appears in any outbound request, and no label
//! arriving from GitHub introduces one locally. `labels_tests.rs` proves the
//! pure `is_workflow_label`/`syncable_labels`/`keep_workflow_labels` functions
//! directly; this proves the same guarantee holds end-to-end through the real
//! `/sync` route, where the denylist constant actually gets exercised.

use std::sync::Arc;

use axum::extract::{Json, Path};
use serde_json::json;

use crate::github_port::IssueState;
use crate::todos::patch_todo;
use crate::todos_github::fake_github::FakeGitHub;
use crate::todos_github::routes::sync;
use crate::todos_github::run_test_support::{insert_pair, insert_todo, issue, link_project};
use crate::todos_github::test_support;

use super::{read, todo_field, update_patch};

#[tokio::test]
async fn ac27_a_local_workflow_label_never_reaches_the_outbound_patch() {
    let fake = Arc::new(FakeGitHub::default().with_issue(issue(
        10,
        "Title",
        "Body",
        IssueState::Open,
        &[],
    )));
    let h = test_support::setup(fake.clone()).await;
    link_project(&h.ctx, "p-ac27-local").await;
    insert_todo(&h.ctx, "t1", "p-ac27-local", "Title", "Body", "open", &[]).await;
    insert_pair(
        &h.ctx,
        "t1",
        "p-ac27-local",
        10,
        "2026-01-01T00:00:00Z",
        "Title",
        "Body",
        "open",
        &[],
    )
    .await;

    read(
        patch_todo(
            test_support::state(&h),
            Path("t1".to_string()),
            Json(json!({ "labels": ["urgent", "route:full"] })),
        )
        .await,
    )
    .await;
    read(
        sync::post_sync(
            test_support::state(&h),
            Json(json!({ "projectId": "p-ac27-local" })),
        )
        .await,
    )
    .await;

    let patch = update_patch(&fake, 10);
    let labels = patch.labels.expect("the label change must have been sent");
    assert!(
        !labels.iter().any(|l| l == "route:full"),
        "a workflow label must never leave the daemon: got {labels:?}"
    );
    assert!(labels.contains(&"urgent".to_string()));
}

#[tokio::test]
async fn ac27_a_workflow_shaped_remote_label_is_never_introduced_locally() {
    let fake = Arc::new(FakeGitHub::default().with_issue(issue(
        10,
        "Title",
        "Body",
        IssueState::Open,
        &["urgent", "route:hijack"],
    )));
    let h = test_support::setup(fake).await;
    link_project(&h.ctx, "p-ac27-remote").await;
    insert_todo(&h.ctx, "t1", "p-ac27-remote", "Title", "Body", "open", &[]).await;
    insert_pair(
        &h.ctx,
        "t1",
        "p-ac27-remote",
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
            Json(json!({ "projectId": "p-ac27-remote" })),
        )
        .await,
    )
    .await;

    let labels = todo_field(&h.ctx, "t1", "labels").await.unwrap();
    assert!(
        !labels.contains("route:hijack"),
        "a workflow-shaped remote label must never be introduced locally: got {labels}"
    );
    assert!(labels.contains("urgent"));
}
