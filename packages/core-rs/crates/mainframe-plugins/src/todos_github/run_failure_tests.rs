//! Task 14: the run driver's failure taxonomy (per-pair vs run-stopping) and
//! report retention. Happy-path and optimization scenarios live in
//! `run_tests.rs`.
//!
//! Every test uses its own project id: the one-run-per-project guard (task
//! 15) is a real process-wide static, and `cargo test` runs these in
//! parallel threads sharing that static.

use std::sync::Arc;
use std::time::Duration;

use crate::github_port::{GitHubPortError, IssueState};
use crate::todos_github::fake_github::{Call, FakeGitHub};
use crate::todos_github::run::run_sync;
use crate::todos_github::run_test_support::{
    insert_pair, insert_todo, issue, link_project, run_count,
};
use crate::todos_github::store;
use crate::todos_github::test_support::setup;

/// A single pair already at rest: local, remote, and baseline agree on every
/// field, so a run should read once and write nothing.
async fn setup_pair_at_rest(
    project: &str,
) -> (Arc<FakeGitHub>, crate::todos_github::test_support::Harness) {
    let fake = Arc::new(FakeGitHub::default().with_issue(issue(
        1,
        "Title",
        "Body",
        IssueState::Open,
        &[],
    )));
    let harness = setup(fake.clone()).await;
    let ctx = &harness.ctx;
    insert_todo(ctx, "t1", project, "Title", "Body", "open", &[]).await;
    link_project(ctx, project).await;
    insert_pair(
        ctx,
        "t1",
        project,
        1,
        "2026-01-01T00:00:00Z",
        "Title",
        "Body",
        "open",
        &[],
    )
    .await;
    (fake, harness)
}

#[tokio::test]
async fn a_request_error_marks_the_pair_errored_and_the_run_continues() {
    let project = "p-request-error";
    let fake = Arc::new(
        FakeGitHub::default()
            .with_get_error(
                1,
                GitHubPortError::Request {
                    status: 503,
                    message: "server error".into(),
                },
            )
            .with_issue(issue(2, "Title", "Body", IssueState::Open, &[])),
    );
    let harness = setup(fake).await;
    let ctx = &harness.ctx;

    insert_todo(ctx, "t1", project, "Title", "Body", "open", &[]).await;
    insert_todo(ctx, "t2", project, "Title", "Body", "open", &[]).await;
    link_project(ctx, project).await;
    insert_pair(
        ctx,
        "t1",
        project,
        1,
        "2026-01-01T00:00:00Z",
        "Title",
        "Body",
        "open",
        &[],
    )
    .await;
    insert_pair(
        ctx,
        "t2",
        project,
        2,
        "2026-01-01T00:00:01Z",
        "Title",
        "Body",
        "open",
        &[],
    )
    .await;

    let run = run_sync(ctx, project).await.unwrap();

    assert_eq!(run.reached, 2);
    assert_eq!(run.pairs_reconciled, 1);
    assert!(run.failure_kind.is_none());

    let errored = store::read_pair_by_todo(ctx, "t1").await.unwrap().unwrap();
    assert_eq!(errored.pair_state, "errored");
    let untouched = store::read_pair_by_todo(ctx, "t2").await.unwrap().unwrap();
    assert_eq!(untouched.pair_state, "clean");
}

#[tokio::test]
async fn a_not_found_pair_is_marked_remotely_unlinked_and_skipped_next_run() {
    let project = "p-not-found";
    let fake = Arc::new(FakeGitHub::default());
    let harness = setup(fake.clone()).await;
    let ctx = &harness.ctx;

    insert_todo(ctx, "t1", project, "Title", "Body", "open", &[]).await;
    link_project(ctx, project).await;
    insert_pair(
        ctx,
        "t1",
        project,
        99,
        "2026-01-01T00:00:00Z",
        "Title",
        "Body",
        "open",
        &[],
    )
    .await;

    run_sync(ctx, project).await.unwrap();

    let pair = store::read_pair_by_todo(ctx, "t1").await.unwrap().unwrap();
    assert_eq!(pair.pair_state, "remotely-unlinked");
    assert_eq!(fake.call_count(), 1);

    run_sync(ctx, project).await.unwrap();
    assert_eq!(
        fake.call_count(),
        1,
        "a following run must not re-fetch the broken pair"
    );
}

#[tokio::test]
async fn a_rate_limited_error_stops_the_run_and_preserves_already_written_baselines() {
    let project = "p-rate-limited";
    let fake = Arc::new(
        FakeGitHub::default()
            .with_issue(issue(1, "Title", "Body", IssueState::Open, &[]))
            .with_get_error(
                2,
                GitHubPortError::RateLimited {
                    wait: Some(Duration::from_secs(30)),
                },
            ),
    );
    let harness = setup(fake.clone()).await;
    let ctx = &harness.ctx;

    insert_todo(ctx, "t1", project, "New title", "Body", "open", &[]).await;
    insert_todo(ctx, "t2", project, "Title", "Body", "open", &[]).await;
    link_project(ctx, project).await;
    insert_pair(
        ctx,
        "t1",
        project,
        1,
        "2026-01-01T00:00:00Z",
        "Title",
        "Body",
        "open",
        &[],
    )
    .await;
    insert_pair(
        ctx,
        "t2",
        project,
        2,
        "2026-01-01T00:00:01Z",
        "Title",
        "Body",
        "open",
        &[],
    )
    .await;

    let run = run_sync(ctx, project).await.unwrap();

    assert_eq!(run.failure_kind.as_deref(), Some("rate_limited"));
    assert_eq!(run.pairs_reconciled, 1);

    let written = store::read_pair_by_todo(ctx, "t1").await.unwrap().unwrap();
    assert_eq!(
        written.base_title, "New title",
        "the baseline written before the stop must survive"
    );
    let unreached = store::read_pair_by_todo(ctx, "t2").await.unwrap().unwrap();
    assert_eq!(unreached.pair_state, "clean");

    let get_issue_2_calls = fake
        .calls
        .lock()
        .unwrap()
        .iter()
        .filter(|c| matches!(c, Call::GetIssue(2)))
        .count();
    assert_eq!(
        get_issue_2_calls, 1,
        "a rate limit must not be retried inline"
    );
}

#[tokio::test]
async fn an_auth_error_stops_the_run_with_no_credential_material_in_the_message() {
    let project = "p-auth";
    let fake = Arc::new(
        FakeGitHub::default().with_get_error(1, GitHubPortError::Auth("token rejected".into())),
    );
    let harness = setup(fake).await;
    let ctx = &harness.ctx;

    insert_todo(ctx, "t1", project, "Title", "Body", "open", &[]).await;
    link_project(ctx, project).await;
    insert_pair(
        ctx,
        "t1",
        project,
        1,
        "2026-01-01T00:00:00Z",
        "Title",
        "Body",
        "open",
        &[],
    )
    .await;

    let run = run_sync(ctx, project).await.unwrap();

    assert_eq!(run.failure_kind.as_deref(), Some("auth"));
    let message = run.failure_message.unwrap();
    assert!(
        !message.contains("acme-widgets-cred"),
        "the credential label must never leak into a failure message"
    );
}

#[tokio::test]
async fn a_second_run_with_nothing_changed_issues_zero_outbound_writes() {
    let (fake, harness) = setup_pair_at_rest("p-noop-writes").await;
    run_sync(&harness.ctx, "p-noop-writes").await.unwrap();
    run_sync(&harness.ctx, "p-noop-writes").await.unwrap();

    let calls = fake.calls.lock().unwrap();
    assert!(
        !calls
            .iter()
            .any(|c| matches!(c, Call::UpdateIssue(..) | Call::CreateIssue(_)))
    );
}

#[tokio::test]
async fn eleven_runs_leave_exactly_ten_reports() {
    let (_fake, harness) = setup_pair_at_rest("p-retention").await;
    for _ in 0..11 {
        run_sync(&harness.ctx, "p-retention").await.unwrap();
    }
    assert_eq!(run_count(&harness.ctx, "p-retention").await, 10);
}

#[tokio::test]
async fn a_run_with_no_overwrites_produces_an_empty_report() {
    let (_fake, harness) = setup_pair_at_rest("p-empty-report").await;
    let run = run_sync(&harness.ctx, "p-empty-report").await.unwrap();
    let report = store::read_report(&harness.ctx, &run.id).await.unwrap();
    assert!(report.is_empty());
}
