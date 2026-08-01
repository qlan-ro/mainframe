//! AC25: a missing or transferred issue marks its pair remotely-unlinked
//! without deleting the task or following a transfer redirect. AC29: auth,
//! rate-limit, and network failures leave unreached pairs untouched, preserve
//! already-written baselines, and surface a readable, credential-free reason.
//!
//! `run_failure_tests.rs` proves these mechanics by calling `run::run_sync`
//! directly; these tests prove the same guarantees hold through the real
//! `/sync`, `/report`, and `/pairs` routes, including the pairs route's
//! surfaced state.

use std::sync::Arc;
use std::time::Duration;

use axum::extract::Json;
use serde_json::json;

use crate::github_port::{GitHubPortError, IssueState};
use crate::todos_github::fake_github::FakeGitHub;
use crate::todos_github::routes::{pairs, sync};
use crate::todos_github::run_test_support::{
    CREDENTIAL, insert_pair, insert_todo, issue, link_project,
};
use crate::todos_github::store;
use crate::todos_github::test_support;

use super::{qs, read, todo_field};

#[tokio::test]
async fn ac25_a_missing_issue_is_remotely_unlinked_the_task_survives_and_is_skipped_next_run() {
    let fake = Arc::new(FakeGitHub::default().with_get_error(10, GitHubPortError::NotFound));
    let h = test_support::setup(fake.clone()).await;
    link_project(&h.ctx, "p-ac25-missing").await;
    insert_todo(
        &h.ctx,
        "t1",
        "p-ac25-missing",
        "Keep me",
        "Body",
        "open",
        &[],
    )
    .await;
    insert_pair(
        &h.ctx,
        "t1",
        "p-ac25-missing",
        10,
        "2026-01-01T00:00:00Z",
        "Keep me",
        "Body",
        "open",
        &[],
    )
    .await;

    read(
        sync::post_sync(
            test_support::state(&h),
            Json(json!({ "projectId": "p-ac25-missing" })),
        )
        .await,
    )
    .await;

    assert_eq!(
        todo_field(&h.ctx, "t1", "title").await.as_deref(),
        Some("Keep me"),
        "a remotely-unlinked pair must never delete the task"
    );

    let (_, pairs_body) = read(
        pairs::get_pairs(
            test_support::state(&h),
            qs(&[("projectId", "p-ac25-missing")]),
        )
        .await,
    )
    .await;
    assert_eq!(
        pairs_body["pairs"][0]["pairState"],
        json!("remotely-unlinked")
    );

    let (_, report_body) = read(
        sync::get_report(
            test_support::state(&h),
            qs(&[("projectId", "p-ac25-missing")]),
        )
        .await,
    )
    .await;
    assert_eq!(
        report_body["report"]["rows"],
        json!([]),
        "a remotely-unlinked pair's state is surfaced by /pairs, never as a report row"
    );

    read(
        sync::post_sync(
            test_support::state(&h),
            Json(json!({ "projectId": "p-ac25-missing" })),
        )
        .await,
    )
    .await;
    assert_eq!(
        fake.call_count(),
        1,
        "a following run must not re-fetch a remotely-unlinked pair"
    );
}

#[tokio::test]
async fn ac25_a_transferred_issue_is_remotely_unlinked_without_following_the_move() {
    let fake = Arc::new(FakeGitHub::default().with_get_error(10, GitHubPortError::Moved));
    let h = test_support::setup(fake.clone()).await;
    link_project(&h.ctx, "p-ac25-moved").await;
    insert_todo(&h.ctx, "t1", "p-ac25-moved", "Keep me", "Body", "open", &[]).await;
    insert_pair(
        &h.ctx,
        "t1",
        "p-ac25-moved",
        10,
        "2026-01-01T00:00:00Z",
        "Keep me",
        "Body",
        "open",
        &[],
    )
    .await;

    read(
        sync::post_sync(
            test_support::state(&h),
            Json(json!({ "projectId": "p-ac25-moved" })),
        )
        .await,
    )
    .await;

    let pair = store::read_pair_by_todo(&h.ctx, "t1")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(pair.pair_state, "remotely-unlinked");
    assert_eq!(
        fake.call_count(),
        1,
        "a moved issue must not be re-fetched at a redirected location within the run"
    );
    assert_eq!(
        todo_field(&h.ctx, "t1", "title").await.as_deref(),
        Some("Keep me")
    );
}

#[tokio::test]
async fn ac29_an_auth_failure_leaves_the_unreached_pair_untouched_with_a_credential_free_reason() {
    let fake = Arc::new(
        FakeGitHub::default()
            .with_get_error(1, GitHubPortError::Auth("token rejected".into()))
            .with_issue(issue(2, "Title", "Body", IssueState::Open, &[])),
    );
    let h = test_support::setup(fake).await;
    link_project(&h.ctx, "p-ac29-auth").await;
    insert_todo(&h.ctx, "t1", "p-ac29-auth", "Title", "Body", "open", &[]).await;
    insert_todo(&h.ctx, "t2", "p-ac29-auth", "Title", "Body", "open", &[]).await;
    insert_pair(
        &h.ctx,
        "t1",
        "p-ac29-auth",
        1,
        "2026-01-01T00:00:00Z",
        "Title",
        "Body",
        "open",
        &[],
    )
    .await;
    insert_pair(
        &h.ctx,
        "t2",
        "p-ac29-auth",
        2,
        "2026-01-01T00:00:01Z",
        "Title",
        "Body",
        "open",
        &[],
    )
    .await;

    let (_, body) = read(
        sync::post_sync(
            test_support::state(&h),
            Json(json!({ "projectId": "p-ac29-auth" })),
        )
        .await,
    )
    .await;

    let failure = &body["run"]["failure"];
    assert_eq!(failure["kind"], json!("auth"));
    let message = failure["message"].as_str().unwrap();
    assert!(
        !message.contains(CREDENTIAL),
        "the credential label must never leak into the route's response body"
    );

    let untouched = store::read_pair_by_todo(&h.ctx, "t2")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        untouched.pair_state, "clean",
        "a pair the run never reached must be left untouched"
    );
}

#[tokio::test]
async fn ac29_a_rate_limited_run_preserves_baselines_already_written_before_it_stopped() {
    let fake = Arc::new(
        FakeGitHub::default()
            .with_issue(issue(1, "New title", "Body", IssueState::Open, &[]))
            .with_get_error(
                2,
                GitHubPortError::RateLimited {
                    wait: Some(Duration::from_secs(30)),
                },
            ),
    );
    let h = test_support::setup(fake).await;
    link_project(&h.ctx, "p-ac29-rate").await;
    insert_todo(
        &h.ctx,
        "t1",
        "p-ac29-rate",
        "New title",
        "Body",
        "open",
        &[],
    )
    .await;
    insert_todo(&h.ctx, "t2", "p-ac29-rate", "Title", "Body", "open", &[]).await;
    insert_pair(
        &h.ctx,
        "t1",
        "p-ac29-rate",
        1,
        "2026-01-01T00:00:00Z",
        "Old title",
        "Body",
        "open",
        &[],
    )
    .await;
    insert_pair(
        &h.ctx,
        "t2",
        "p-ac29-rate",
        2,
        "2026-01-01T00:00:01Z",
        "Title",
        "Body",
        "open",
        &[],
    )
    .await;

    let (_, body) = read(
        sync::post_sync(
            test_support::state(&h),
            Json(json!({ "projectId": "p-ac29-rate" })),
        )
        .await,
    )
    .await;

    assert_eq!(body["run"]["failure"]["kind"], json!("rate-limit"));

    let reconciled = store::read_pair_by_todo(&h.ctx, "t1")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        reconciled.base_title, "New title",
        "the baseline written before the run stopped must survive"
    );
    let unreached = store::read_pair_by_todo(&h.ctx, "t2")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(unreached.pair_state, "clean");
}
