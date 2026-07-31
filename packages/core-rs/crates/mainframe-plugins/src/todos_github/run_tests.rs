//! Task 14: the sync-run driver's happy path, its AC7 pair-scoping guarantee,
//! the one-run-per-project guard, and the `needs_field_times` call-avoidance
//! optimization. Failure-taxonomy and retention scenarios live in
//! `run_failure_tests.rs`, split out to keep both files under the line cap.
//!
//! Every test uses its own project id: the one-run-per-project guard (task
//! 15) is a real process-wide static, and `cargo test` runs these in
//! parallel threads sharing that static.

use std::sync::Arc;

use crate::github_port::IssueState;
use crate::todos_github::fake_github::{Call, FakeGitHub};
use crate::todos_github::run::{RunError, run_sync};
use crate::todos_github::run_test_support::{
    insert_pair, insert_todo, issue, link_project, todo_title,
};
use crate::todos_github::store;
use crate::todos_github::test_support::setup;

#[tokio::test]
async fn reconciles_the_pair_and_writes_a_new_baseline() {
    let project = "p-reconcile";
    let fake = Arc::new(FakeGitHub::default().with_issue(issue(
        42,
        "Old title",
        "body",
        IssueState::Open,
        &[],
    )));
    let harness = setup(fake.clone()).await;
    let ctx = &harness.ctx;

    insert_todo(ctx, "t1", project, "New title", "body", "open", &[]).await;
    link_project(ctx, project).await;
    insert_pair(
        ctx,
        "t1",
        project,
        42,
        "2026-01-01T00:00:00Z",
        "Old title",
        "body",
        "open",
        &[],
    )
    .await;

    let run = run_sync(ctx, project).await.unwrap();

    assert_eq!(run.pairs_reconciled, 1);
    assert_eq!(run.total, 1);
    assert!(run.failure_kind.is_none());

    let pair = store::read_pair_by_todo(ctx, "t1").await.unwrap().unwrap();
    assert_eq!(pair.base_title, "New title");

    let calls = fake.calls.lock().unwrap();
    assert!(calls.iter().any(|c| matches!(c, Call::GetIssue(42))));
    assert!(calls.iter().any(|c| matches!(c, Call::UpdateIssue(42, _))));
}

#[tokio::test]
async fn an_unpaired_todo_is_never_fetched_or_written() {
    let project = "p-unpaired";
    let fake = Arc::new(
        FakeGitHub::default()
            .with_issue(issue(42, "Old title", "body", IssueState::Open, &[]))
            .with_issue(issue(999, "Decoy", "decoy body", IssueState::Open, &[])),
    );
    let harness = setup(fake.clone()).await;
    let ctx = &harness.ctx;

    insert_todo(ctx, "t1", project, "Old title", "body", "open", &[]).await;
    insert_todo(ctx, "t2", project, "Untouched", "unpaired", "open", &[]).await;
    link_project(ctx, project).await;
    insert_pair(
        ctx,
        "t1",
        project,
        42,
        "2026-01-01T00:00:00Z",
        "Old title",
        "body",
        "open",
        &[],
    )
    .await;

    run_sync(ctx, project).await.unwrap();

    {
        let calls = fake.calls.lock().unwrap();
        assert!(!calls.iter().any(|c| matches!(c, Call::GetIssue(999))));
        assert_eq!(calls.len(), 1, "a no-op pair should cost exactly one read");
    }
    assert_eq!(todo_title(ctx, "t2").await, "Untouched");
}

#[tokio::test]
async fn a_second_run_is_refused_while_one_is_in_flight() {
    let project = "p-guard";
    let fake = Arc::new(FakeGitHub::default().with_issue(issue(
        42,
        "Old title",
        "body",
        IssueState::Open,
        &[],
    )));
    let harness = setup(fake).await;
    let ctx = &harness.ctx;

    insert_todo(ctx, "t1", project, "Old title", "body", "open", &[]).await;
    link_project(ctx, project).await;
    insert_pair(
        ctx,
        "t1",
        project,
        42,
        "2026-01-01T00:00:00Z",
        "Old title",
        "body",
        "open",
        &[],
    )
    .await;

    let (first, second) = tokio::join!(run_sync(ctx, project), run_sync(ctx, project));

    assert!(first.is_ok());
    assert!(matches!(second, Err(RunError::AlreadyRunning)));
}

#[tokio::test]
async fn field_times_are_not_fetched_when_only_one_side_changed_the_title() {
    let project = "p-field-times-one-side";
    let fake = Arc::new(FakeGitHub::default().with_issue(issue(
        1,
        "Old title",
        "body",
        IssueState::Open,
        &[],
    )));
    let harness = setup(fake.clone()).await;
    let ctx = &harness.ctx;

    insert_todo(ctx, "t1", project, "Locally renamed", "body", "open", &[]).await;
    link_project(ctx, project).await;
    insert_pair(
        ctx,
        "t1",
        project,
        1,
        "2026-01-01T00:00:00Z",
        "Old title",
        "body",
        "open",
        &[],
    )
    .await;

    run_sync(ctx, project).await.unwrap();

    let calls = fake.calls.lock().unwrap();
    assert!(!calls.iter().any(|c| matches!(c, Call::IssueFieldTimes(_))));
}

#[tokio::test]
async fn field_times_are_fetched_when_both_sides_changed_the_title() {
    let project = "p-field-times-both-sides";
    let fake = Arc::new(FakeGitHub::default().with_issue(issue(
        1,
        "Remote new title",
        "body",
        IssueState::Open,
        &[],
    )));
    let harness = setup(fake.clone()).await;
    let ctx = &harness.ctx;

    insert_todo(ctx, "t1", project, "Local new title", "body", "open", &[]).await;
    link_project(ctx, project).await;
    insert_pair(
        ctx,
        "t1",
        project,
        1,
        "2026-01-01T00:00:00Z",
        "Old title",
        "body",
        "open",
        &[],
    )
    .await;

    run_sync(ctx, project).await.unwrap();

    let calls = fake.calls.lock().unwrap();
    assert!(calls.iter().any(|c| matches!(c, Call::IssueFieldTimes(1))));
}
