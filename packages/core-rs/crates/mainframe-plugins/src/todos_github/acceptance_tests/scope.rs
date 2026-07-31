//! AC7: an unpaired task is never included in any outbound request and never
//! read by a sync run. AC24: deleting a task removes its pairing, issues no
//! GitHub request, and leaves the issue untouched.
//!
//! `run_tests.rs::an_unpaired_todo_is_never_fetched_or_written` already
//! proves AC7's core claim by calling `run::run_sync` directly; this test
//! proves the same guarantee holds through the real `/sync` route.

use std::sync::Arc;

use axum::extract::{Json, Path};
use serde_json::json;

use crate::github_port::IssueState;
use crate::todos::delete_todo;
use crate::todos_github::fake_github::{Call, FakeGitHub};
use crate::todos_github::routes::sync;
use crate::todos_github::run_test_support::{insert_pair, insert_todo, issue, link_project};
use crate::todos_github::store;
use crate::todos_github::test_support;

use super::read;

#[tokio::test]
async fn ac7_an_unpaired_todo_is_never_fetched_or_written_by_post_sync() {
    let fake = Arc::new(FakeGitHub::default().with_issue(issue(
        99,
        "Decoy",
        "decoy body",
        IssueState::Open,
        &[],
    )));
    let h = test_support::setup(fake.clone()).await;
    link_project(&h.ctx, "p-ac7").await;
    insert_todo(&h.ctx, "t1", "p-ac7", "Untouched", "unpaired", "open", &[]).await;

    let (_, body) = read(
        sync::post_sync(
            test_support::state(&h),
            Json(json!({ "projectId": "p-ac7" })),
        )
        .await,
    )
    .await;

    assert_eq!(body["run"]["total"], json!(0));
    assert_eq!(fake.call_count(), 0);
}

#[tokio::test]
async fn ac24_deleting_a_paired_task_drops_the_pair_and_calls_github_nothing() {
    let fake = Arc::new(FakeGitHub::default().with_issue(issue(
        10,
        "Fix crash",
        "body",
        IssueState::Open,
        &[],
    )));
    let h = test_support::setup(fake.clone()).await;
    link_project(&h.ctx, "p-ac24").await;
    insert_todo(&h.ctx, "t1", "p-ac24", "Fix crash", "body", "open", &[]).await;
    insert_pair(
        &h.ctx,
        "t1",
        "p-ac24",
        10,
        "2026-01-01T00:00:00Z",
        "Fix crash",
        "body",
        "open",
        &[],
    )
    .await;

    read(delete_todo(test_support::state(&h), Path("t1".to_string())).await).await;

    assert_eq!(
        store::read_pair_by_todo(&h.ctx, "t1").await.unwrap(),
        None,
        "deleting the task must drop its pairing"
    );
    assert!(
        !fake
            .calls
            .lock()
            .unwrap()
            .iter()
            .any(|c| matches!(c, Call::UpdateIssue(..) | Call::CreateIssue(_))),
        "deleting a task must never write to its paired issue"
    );
}
