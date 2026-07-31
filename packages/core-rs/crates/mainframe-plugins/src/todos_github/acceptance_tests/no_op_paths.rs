//! AC15: an inbound change applied by a run does not read as a local edit on
//! the next run. AC22: one-sided applications and label merges produce no
//! report rows, even though they do write.

use std::sync::Arc;

use axum::extract::Json;
use serde_json::json;

use crate::db_context::text;
use crate::github_port::IssueState;
use crate::todos_github::fake_github::FakeGitHub;
use crate::todos_github::routes::sync;
use crate::todos_github::run_test_support::{insert_pair, insert_todo, issue, link_project};
use crate::todos_github::test_support;

use super::{read, todo_field, writes_happened};

#[tokio::test]
async fn ac15_an_applied_inbound_change_is_not_stamped_as_a_local_edit() {
    let fake = Arc::new(FakeGitHub::default().with_issue(issue(
        10,
        "New title",
        "Body",
        IssueState::Open,
        &[],
    )));
    let h = test_support::setup(fake.clone()).await;
    link_project(&h.ctx, "p-ac15").await;
    insert_todo(&h.ctx, "t1", "p-ac15", "Old title", "Body", "open", &[]).await;
    insert_pair(
        &h.ctx,
        "t1",
        "p-ac15",
        10,
        "2026-01-01T00:00:00Z",
        "Old title",
        "Body",
        "open",
        &[],
    )
    .await;

    read(
        sync::post_sync(
            test_support::state(&h),
            Json(json!({ "projectId": "p-ac15" })),
        )
        .await,
    )
    .await;
    assert_eq!(
        todo_field(&h.ctx, "t1", "title").await.as_deref(),
        Some("New title")
    );
    let touch_rows = h
        .ctx
        .db
        .query_one(
            "SELECT COUNT(*) as n FROM github_touch WHERE todo_id = ? AND field = 'title'".into(),
            vec![text("t1".to_string())],
        )
        .await
        .unwrap()
        .and_then(|r| r.get("n").and_then(|v| v.as_i64()))
        .unwrap_or(-1);
    assert_eq!(
        touch_rows, 0,
        "applying an inbound title must never stamp it as a local edit"
    );

    let (_, second) = read(
        sync::post_sync(
            test_support::state(&h),
            Json(json!({ "projectId": "p-ac15" })),
        )
        .await,
    )
    .await;
    assert_eq!(second["run"]["overwrites"], json!(0));
    assert!(!writes_happened(&fake));
}

#[tokio::test]
async fn ac22_a_one_sided_apply_and_a_label_merge_produce_no_report_rows() {
    let fake = Arc::new(FakeGitHub::default().with_issue(issue(
        10,
        "Title",
        "Body",
        IssueState::Open,
        &["beta"],
    )));
    let h = test_support::setup(fake.clone()).await;
    link_project(&h.ctx, "p-ac22").await;
    insert_todo(
        &h.ctx,
        "t1",
        "p-ac22",
        "Local title",
        "Body",
        "open",
        &["alpha"],
    )
    .await;
    insert_pair(
        &h.ctx,
        "t1",
        "p-ac22",
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
            Json(json!({ "projectId": "p-ac22" })),
        )
        .await,
    )
    .await;
    let run_id = body["run"]["runId"].as_str().unwrap().to_string();

    assert!(
        writes_happened(&fake),
        "sanity: the title and label changes must have actually gone out"
    );
    let (_, report_body) = read(
        sync::get_report(
            test_support::state(&h),
            super::qs(&[("projectId", "p-ac22"), ("runId", &run_id)]),
        )
        .await,
    )
    .await;
    assert_eq!(report_body["report"]["rows"], json!([]));
}
