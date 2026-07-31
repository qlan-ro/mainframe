//! `DELETE /link`'s project-wide cascade: pairs, runs, and reports go; todos
//! stay (AC — only the pairing plugin's own tables are the sync engine's to
//! delete).

use axum::extract::Json;
use axum::http::StatusCode;
use serde_json::{Value, json};

use crate::github_port::IssueState;
use crate::todos_github::fake_github::FakeGitHub;
use crate::todos_github::routes::{link, pairs, sync};
use crate::todos_github::run_test_support::{
    insert_pair, insert_todo, issue, link_project, todo_title,
};
use crate::todos_github::test_support;

use super::{qs, read, setup};

#[tokio::test]
async fn delete_link_cascades_pairs_runs_and_reports_but_not_todos() {
    let h = setup(FakeGitHub::default().with_issue(issue(
        10,
        "Fix crash",
        "body",
        IssueState::Open,
        &[],
    )))
    .await;
    // A dedicated project id — `run::RUNNING` is a process-wide static keyed
    // only by project id, so reusing "p1" here would race the other
    // `post_sync` tests running in parallel threads.
    link_project(&h.ctx, "p-delete-link").await;
    insert_todo(
        &h.ctx,
        "t1",
        "p-delete-link",
        "Fix crash",
        "body",
        "open",
        &[],
    )
    .await;
    insert_pair(
        &h.ctx,
        "t1",
        "p-delete-link",
        10,
        "2026-01-01T00:00:00Z",
        "Fix crash",
        "body",
        "open",
        &[],
    )
    .await;
    read(
        sync::post_sync(
            test_support::state(&h),
            Json(json!({ "projectId": "p-delete-link" })),
        )
        .await,
    )
    .await;

    let (status, _) = read(
        link::delete_link(
            test_support::state(&h),
            qs(&[("projectId", "p-delete-link")]),
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (_, pairs_body) = read(
        pairs::get_pairs(
            test_support::state(&h),
            qs(&[("projectId", "p-delete-link")]),
        )
        .await,
    )
    .await;
    assert_eq!(pairs_body["pairs"], json!([]));

    let (_, report_body) = read(
        sync::get_report(
            test_support::state(&h),
            qs(&[("projectId", "p-delete-link")]),
        )
        .await,
    )
    .await;
    assert_eq!(report_body["report"], Value::Null);

    assert_eq!(todo_title(&h.ctx, "t1").await, "Fix crash");
}
