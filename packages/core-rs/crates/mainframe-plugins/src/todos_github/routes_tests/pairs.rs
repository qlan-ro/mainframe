//! `/pairs`, `/pairs/{todoId}`, `/issues`, `/import`, `/publish` tests.

use axum::extract::{Json, Path};
use axum::http::StatusCode;
use serde_json::json;

use crate::github_port::{GitHubPortError, IssueState};
use crate::todos_github::fake_github::FakeGitHub;
use crate::todos_github::routes::pairs;
use crate::todos_github::run_test_support::{
    OWNER, REPO, insert_pair, insert_todo, issue, link_project, todo_title,
};
use crate::todos_github::test_support;

use super::{qs, read, setup};

#[tokio::test]
async fn get_pairs_includes_remotely_unlinked_pairs() {
    use crate::todos_github::store;

    let h = setup(FakeGitHub::default()).await;
    link_project(&h.ctx, "p1").await;
    insert_todo(&h.ctx, "t1", "p1", "Fix crash", "body", "open", &[]).await;
    insert_pair(
        &h.ctx,
        "t1",
        "p1",
        10,
        "2026-01-01T00:00:00Z",
        "Fix crash",
        "body",
        "open",
        &[],
    )
    .await;
    // `run_test_support::insert_todo` hardcodes number 1 (fixture built for
    // single-todo run tests) — insert t2's row directly so it gets number 2.
    h.ctx
        .db
        .execute(
            "INSERT INTO todos (id, number, project_id, title, body, status, labels, created_at, updated_at)
             VALUES ('t2', 2, 'p1', 'Deleted issue', 'body', 'open', '[]', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"
                .into(),
            vec![],
        )
        .await
        .unwrap();
    insert_pair(
        &h.ctx,
        "t2",
        "p1",
        11,
        "2026-01-02T00:00:00Z",
        "Deleted issue",
        "body",
        "open",
        &[],
    )
    .await;
    store::set_pair_state(&h.ctx, "t2", "remotely-unlinked", Some("not found"))
        .await
        .unwrap();

    let (status, body) =
        read(pairs::get_pairs(test_support::state(&h), qs(&[("projectId", "p1")])).await).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["pairs"],
        json!([
            {
                "todoId": "t1", "todoNumber": 1, "issueNumber": 10,
                "issueUrl": format!("https://github.com/{OWNER}/{REPO}/issues/10"),
                "pairState": "clean", "stateReason": null,
            },
            {
                "todoId": "t2", "todoNumber": 2, "issueNumber": 11,
                "issueUrl": format!("https://github.com/{OWNER}/{REPO}/issues/11"),
                "pairState": "remotely-unlinked", "stateReason": "not found",
            },
        ])
    );
}

#[tokio::test]
async fn delete_pair_removes_it_writes_nothing_and_calls_github_nothing() {
    let h = setup(FakeGitHub::default()).await;
    link_project(&h.ctx, "p1").await;
    insert_todo(&h.ctx, "t1", "p1", "Fix crash", "body", "open", &[]).await;
    insert_pair(
        &h.ctx,
        "t1",
        "p1",
        10,
        "2026-01-01T00:00:00Z",
        "Fix crash",
        "body",
        "open",
        &[],
    )
    .await;

    let (status, _) =
        read(pairs::delete_pair(test_support::state(&h), Path("t1".to_string())).await).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (_, body) =
        read(pairs::get_pairs(test_support::state(&h), qs(&[("projectId", "p1")])).await).await;
    assert_eq!(body["pairs"], json!([]));
    assert_eq!(todo_title(&h.ctx, "t1").await, "Fix crash");
}

#[tokio::test]
async fn get_issues_lists_open_issues_annotated_with_pairing() {
    let h = setup(FakeGitHub::default().with_open_issues(vec![issue(
        10,
        "Fix crash",
        "",
        IssueState::Open,
        &[],
    )]))
    .await;
    link_project(&h.ctx, "p1").await;
    insert_todo(&h.ctx, "t1", "p1", "Fix crash", "body", "open", &[]).await;
    insert_pair(
        &h.ctx,
        "t1",
        "p1",
        10,
        "2026-01-01T00:00:00Z",
        "Fix crash",
        "body",
        "open",
        &[],
    )
    .await;

    let (status, body) =
        read(pairs::get_issues(test_support::state(&h), qs(&[("projectId", "p1")])).await).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["issues"],
        json!([{ "number": 10, "title": "Fix crash", "labels": [], "pairedTodoNumber": 1 }])
    );
}

/// A missing credential must surface its own readable message, not a masked
/// 500 that reads identically to a real server bug (QA S9).
#[tokio::test]
async fn get_issues_surfaces_the_auth_failure_instead_of_masking_it_as_a_server_error() {
    let h = setup(FakeGitHub::default().with_list_error(GitHubPortError::Auth(
        "No GitHub credential is stored for 'github'. Link the repository again to connect one."
            .to_string(),
    )))
    .await;
    link_project(&h.ctx, "p1").await;

    let (status, body) =
        read(pairs::get_issues(test_support::state(&h), qs(&[("projectId", "p1")])).await).await;
    assert_ne!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(
        body["error"]
            .as_str()
            .unwrap()
            .contains("No GitHub credential is stored")
    );
}

#[tokio::test]
async fn post_import_creates_todos_and_reports_skips() {
    let h = setup(FakeGitHub::default().with_issue(issue(
        10,
        "Fix crash",
        "body",
        IssueState::Open,
        &[],
    )))
    .await;
    link_project(&h.ctx, "p1").await;

    let (status, body) = read(
        pairs::post_import(
            test_support::state(&h),
            Json(json!({ "projectId": "p1", "issueNumbers": [10] })),
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["imported"][0]["issueNumber"], json!(10));
    assert_eq!(body["skipped"], json!([]));
}

#[tokio::test]
async fn post_import_rejects_non_array_issue_numbers() {
    let h = setup(FakeGitHub::default()).await;
    let (status, body) = read(
        pairs::post_import(
            test_support::state(&h),
            Json(json!({ "projectId": "p1", "issueNumbers": "not-an-array" })),
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].is_string());
}

#[tokio::test]
async fn post_publish_creates_pair_then_conflicts_on_second_publish() {
    let h = setup(FakeGitHub::default().with_create_result(issue(
        11,
        "New task",
        "body",
        IssueState::Open,
        &[],
    )))
    .await;
    link_project(&h.ctx, "p1").await;
    insert_todo(&h.ctx, "t1", "p1", "New task", "body", "open", &[]).await;

    let (status, body) = read(
        pairs::post_publish(
            test_support::state(&h),
            Json(json!({ "projectId": "p1", "todoId": "t1" })),
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["pair"]["todoId"], json!("t1"));
    assert_eq!(body["pair"]["todoNumber"], json!(1));
    assert_eq!(body["pair"]["issueNumber"], json!(11));

    let (status, _) = read(
        pairs::post_publish(
            test_support::state(&h),
            Json(json!({ "projectId": "p1", "todoId": "t1" })),
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}

/// Same masking bug as `get_issues`, on the write side (QA S4).
#[tokio::test]
async fn post_publish_surfaces_the_auth_failure_instead_of_masking_it_as_a_server_error() {
    let h = setup(FakeGitHub::default().with_create_error(GitHubPortError::Auth(
        "No GitHub credential is stored for 'github'. Link the repository again to connect one."
            .to_string(),
    )))
    .await;
    link_project(&h.ctx, "p1").await;
    insert_todo(&h.ctx, "t1", "p1", "New task", "body", "open", &[]).await;

    let (status, body) = read(
        pairs::post_publish(
            test_support::state(&h),
            Json(json!({ "projectId": "p1", "todoId": "t1" })),
        )
        .await,
    )
    .await;
    assert_ne!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(
        body["error"]
            .as_str()
            .unwrap()
            .contains("No GitHub credential is stored")
    );
}
