//! `POST /sync` and `GET /report` tests.

use axum::extract::Json;
use axum::http::StatusCode;
use serde_json::{Value, json};

use crate::db_context::text;
use crate::github_port::{GitHubPortError, IssueFieldTimes, IssueState};
use crate::todos_github::fake_github::FakeGitHub;
use crate::todos_github::routes::sync;
use crate::todos_github::run_test_support::{insert_pair, insert_todo, issue, link_project};
use crate::todos_github::test_support;

use super::{qs, read, setup};

#[tokio::test]
async fn post_sync_happy_path_returns_run_summary_shape() {
    let h = setup(FakeGitHub::default().with_issue(issue(
        10,
        "Fix crash",
        "body",
        IssueState::Open,
        &[],
    )))
    .await;
    link_project(&h.ctx, "p-sync-happy").await;
    insert_todo(
        &h.ctx,
        "t1",
        "p-sync-happy",
        "Fix crash",
        "body",
        "open",
        &[],
    )
    .await;
    insert_pair(
        &h.ctx,
        "t1",
        "p-sync-happy",
        10,
        "2026-01-01T00:00:00Z",
        "Fix crash",
        "body",
        "open",
        &[],
    )
    .await;

    let (status, body) = read(
        sync::post_sync(
            test_support::state(&h),
            Json(json!({ "projectId": "p-sync-happy" })),
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let run = &body["run"];
    assert!(run["runId"].is_string());
    assert!(run["finishedAt"].is_string());
    assert_eq!(run["pairsReconciled"], json!(1));
    assert_eq!(run["overwrites"], json!(0));
    assert_eq!(run["failure"], Value::Null);
    assert_eq!(run["reached"], json!(1));
    assert_eq!(run["total"], json!(1));
}

#[tokio::test]
async fn post_sync_maps_auth_failure_to_the_frozen_kind() {
    let h =
        setup(FakeGitHub::default().with_get_error(10, GitHubPortError::Auth("bad token".into())))
            .await;
    link_project(&h.ctx, "p-sync-auth-fail").await;
    insert_todo(
        &h.ctx,
        "t1",
        "p-sync-auth-fail",
        "Fix crash",
        "body",
        "open",
        &[],
    )
    .await;
    insert_pair(
        &h.ctx,
        "t1",
        "p-sync-auth-fail",
        10,
        "2026-01-01T00:00:00Z",
        "Fix crash",
        "body",
        "open",
        &[],
    )
    .await;

    let (_, body) = read(
        sync::post_sync(
            test_support::state(&h),
            Json(json!({ "projectId": "p-sync-auth-fail" })),
        )
        .await,
    )
    .await;
    assert_eq!(body["run"]["failure"]["kind"], json!("auth"));
    assert!(
        body["run"]["failure"]["message"]
            .as_str()
            .unwrap()
            .contains("bad token")
    );
}

#[tokio::test]
async fn post_sync_while_running_returns_409_with_readable_message() {
    let h = setup(FakeGitHub::default()).await;
    link_project(&h.ctx, "p-sync-running").await;

    let (first, second) = tokio::join!(
        sync::post_sync(
            test_support::state(&h),
            Json(json!({ "projectId": "p-sync-running" }))
        ),
        sync::post_sync(
            test_support::state(&h),
            Json(json!({ "projectId": "p-sync-running" }))
        ),
    );
    let (status_a, body_a) = read(first).await;
    let (status_b, body_b) = read(second).await;
    let mut statuses = [status_a, status_b];
    statuses.sort_by_key(StatusCode::as_u16);
    assert_eq!(statuses, [StatusCode::OK, StatusCode::CONFLICT]);

    let conflict_body = if status_a == StatusCode::CONFLICT {
        body_a
    } else {
        body_b
    };
    let message = conflict_body["error"].as_str().unwrap();
    assert!(!message.is_empty());
}

#[tokio::test]
async fn get_report_is_null_when_project_has_no_runs() {
    let h = setup(FakeGitHub::default()).await;
    link_project(&h.ctx, "p1").await;
    let (status, body) =
        read(sync::get_report(test_support::state(&h), qs(&[("projectId", "p1")])).await).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "report": null }));
}

/// A genuine title dispute (both sides moved since the baseline) where the
/// local touch stamp is newer than GitHub's `renamed` event — local wins, so
/// the stored `winner` is reconcile's internal `"local"`, which the report
/// route must translate to the wire's `"mainframe"`.
#[tokio::test]
async fn get_report_returns_rows_with_winner_mapped_to_mainframe() {
    let h = setup(
        FakeGitHub::default()
            .with_issue(issue(10, "Remote title", "body", IssueState::Open, &[]))
            .with_field_times(
                10,
                IssueFieldTimes {
                    title_at: Some("2026-01-01T00:00:00Z".to_string()),
                    state_at: None,
                },
            ),
    )
    .await;
    link_project(&h.ctx, "p-report-winner").await;
    insert_todo(
        &h.ctx,
        "t1",
        "p-report-winner",
        "Local title",
        "body",
        "open",
        &[],
    )
    .await;
    insert_pair(
        &h.ctx,
        "t1",
        "p-report-winner",
        10,
        "2026-01-01T00:00:00Z",
        "Baseline title",
        "body",
        "open",
        &[],
    )
    .await;
    h.ctx
        .db
        .execute(
            "INSERT INTO github_touch (todo_id, field, changed_at) VALUES (?, 'title', ?)".into(),
            vec![
                text("t1".to_string()),
                text("2027-01-01T00:00:00Z".to_string()),
            ],
        )
        .await
        .unwrap();

    let (_, sync_body) = read(
        sync::post_sync(
            test_support::state(&h),
            Json(json!({ "projectId": "p-report-winner" })),
        )
        .await,
    )
    .await;
    let run_id = sync_body["run"]["runId"].as_str().unwrap().to_string();
    assert_eq!(sync_body["run"]["overwrites"], json!(1));

    let (status, body) = read(
        sync::get_report(
            test_support::state(&h),
            qs(&[("projectId", "p-report-winner"), ("runId", &run_id)]),
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let report = &body["report"];
    assert_eq!(report["runId"], json!(run_id));
    let row = &report["rows"][0];
    assert_eq!(row["field"], json!("title"));
    assert_eq!(row["winner"], json!("mainframe"));
    assert_eq!(row["rule"], json!("recency"));
    assert_eq!(row["winningValue"], json!("Local title"));
    assert_eq!(row["replacedValue"], json!("Remote title"));
    assert!(row["todoNumber"].is_number());
}
