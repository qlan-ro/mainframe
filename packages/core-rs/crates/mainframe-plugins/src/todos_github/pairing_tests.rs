//! Task 16: explicit pairing — import creates one task per selected issue
//! (AC3, AC5), re-import is idempotent (AC4), publish creates an issue from
//! an existing task and closes it when the task is `done` (AC6), a paired
//! task refuses a second publish, and the issue list annotates pairing
//! (AC4).

use std::sync::Arc;

use crate::db_context::text;
use crate::github_port::{GitHubPortError, IssueState};
use crate::todos_github::fake_github::{Call, FakeGitHub};
use crate::todos_github::pairing::{self, PairingError};
use crate::todos_github::run_test_support::{insert_pair, insert_todo, issue, link_project};
use crate::todos_github::store;
use crate::todos_github::test_support::setup;

async fn todo_count(ctx: &crate::PluginContext, project_id: &str) -> i64 {
    ctx.db
        .query_one(
            "SELECT COUNT(*) as n FROM todos WHERE project_id = ?".into(),
            vec![text(project_id.to_string())],
        )
        .await
        .unwrap()
        .and_then(|row| row.get("n").and_then(|v| v.as_i64()))
        .unwrap_or(0)
}

#[tokio::test]
async fn import_creates_one_todo_per_issue_verbatim_open_and_syncable_labels_only() {
    let fake = Arc::new(FakeGitHub::default().with_issue(issue(
        10,
        "Bug: crash on save",
        "Steps to reproduce…",
        IssueState::Open,
        &["bug", "route:frontend"],
    )));
    let harness = setup(fake).await;
    let ctx = &harness.ctx;
    link_project(ctx, "p1").await;

    let result = pairing::import_issues(ctx, "p1", &[10]).await.unwrap();

    assert_eq!(result.imported.len(), 1);
    assert_eq!(result.imported[0].issue_number, 10);
    let todo_id = result.imported[0].todo_id.clone();

    let row = ctx
        .db
        .query_one(
            "SELECT * FROM todos WHERE id = ?".into(),
            vec![text(todo_id.clone())],
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        row.get("title").unwrap().as_str().unwrap(),
        "Bug: crash on save"
    );
    assert_eq!(
        row.get("body").unwrap().as_str().unwrap(),
        "Steps to reproduce…"
    );
    assert_eq!(row.get("status").unwrap().as_str().unwrap(), "open");
    assert_eq!(row.get("labels").unwrap().as_str().unwrap(), "[\"bug\"]");

    let pair = store::read_pair_by_todo(ctx, &todo_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(pair.base_title, "Bug: crash on save");
    assert_eq!(pair.base_state, "open");
    assert_eq!(pair.base_labels, vec!["bug".to_string()]);
}

#[tokio::test]
async fn reimporting_the_same_issue_is_idempotent_and_reports_it_skipped() {
    let fake = Arc::new(FakeGitHub::default().with_issue(issue(
        10,
        "Title",
        "Body",
        IssueState::Open,
        &[],
    )));
    let harness = setup(fake).await;
    let ctx = &harness.ctx;
    link_project(ctx, "p1").await;

    pairing::import_issues(ctx, "p1", &[10]).await.unwrap();
    let second = pairing::import_issues(ctx, "p1", &[10]).await.unwrap();

    assert!(second.imported.is_empty());
    assert_eq!(second.skipped.len(), 1);
    assert_eq!(second.skipped[0].issue_number, 10);
    assert_eq!(todo_count(ctx, "p1").await, 1);
}

#[tokio::test]
async fn publish_creates_the_issue_from_the_task_and_strips_workflow_labels() {
    let fake = Arc::new(FakeGitHub::default());
    let harness = setup(fake.clone()).await;
    let ctx = &harness.ctx;
    link_project(ctx, "p1").await;
    insert_todo(
        ctx,
        "t1",
        "p1",
        "My task",
        "Task body",
        "open",
        &["bug", "route:frontend"],
    )
    .await;

    let pair = pairing::publish_task(ctx, "p1", "t1").await.unwrap();

    assert_eq!(pair.base_title, "My task");
    assert_eq!(pair.base_state, "open");
    assert_eq!(pair.base_labels, vec!["bug".to_string()]);

    let calls = fake.calls.lock().unwrap();
    assert!(calls.iter().any(|c| matches!(
        c,
        Call::CreateIssue(create) if create.labels == vec!["bug".to_string()]
    )));
}

#[tokio::test]
async fn publishing_a_done_task_creates_the_issue_and_closes_it_as_completed() {
    let fake = Arc::new(
        FakeGitHub::default()
            .with_issue(issue(5, "Done task", "Body", IssueState::Open, &[]))
            .with_create_result(issue(5, "Done task", "Body", IssueState::Open, &[])),
    );
    let harness = setup(fake.clone()).await;
    let ctx = &harness.ctx;
    link_project(ctx, "p1").await;
    insert_todo(ctx, "t1", "p1", "Done task", "Body", "done", &[]).await;

    let pair = pairing::publish_task(ctx, "p1", "t1").await.unwrap();

    assert_eq!(pair.base_state, "closed");
    let calls = fake.calls.lock().unwrap();
    assert!(calls.iter().any(|c| matches!(c, Call::CreateIssue(_))));
    assert!(calls.iter().any(|c| matches!(
        c,
        Call::UpdateIssue(5, patch) if patch.state == Some(IssueState::Closed)
    )));
}

#[tokio::test]
async fn publishing_an_already_paired_task_is_refused() {
    let fake = Arc::new(FakeGitHub::default());
    let harness = setup(fake.clone()).await;
    let ctx = &harness.ctx;
    link_project(ctx, "p1").await;
    insert_todo(ctx, "t1", "p1", "Title", "Body", "open", &[]).await;
    insert_pair(
        ctx,
        "t1",
        "p1",
        42,
        "2026-01-01T00:00:00Z",
        "Title",
        "Body",
        "open",
        &[],
    )
    .await;

    let result = pairing::publish_task(ctx, "p1", "t1").await;

    assert!(matches!(result, Err(PairingError::AlreadyPaired)));
    assert_eq!(
        fake.call_count(),
        0,
        "a refused publish must never call GitHub"
    );
}

#[tokio::test]
async fn listing_issues_annotates_already_paired_ones_with_their_todo_number() {
    let fake = Arc::new(FakeGitHub::default().with_open_issues(vec![
        issue(1, "Unpaired issue", "Body", IssueState::Open, &[]),
        issue(2, "Paired issue", "Body", IssueState::Open, &[]),
    ]));
    let harness = setup(fake).await;
    let ctx = &harness.ctx;
    link_project(ctx, "p1").await;
    insert_todo(ctx, "t1", "p1", "Title", "Body", "open", &[]).await;
    insert_pair(
        ctx,
        "t1",
        "p1",
        2,
        "2026-01-01T00:00:00Z",
        "Title",
        "Body",
        "open",
        &[],
    )
    .await;

    let issues = pairing::list_remote_issues(ctx, "p1").await.unwrap();

    let unpaired = issues.iter().find(|i| i.number == 1).unwrap();
    let paired = issues.iter().find(|i| i.number == 2).unwrap();
    assert_eq!(unpaired.paired_todo_number, None);
    assert_eq!(paired.paired_todo_number, Some(1));
}

#[tokio::test]
async fn listing_issues_surfaces_a_list_fetch_error() {
    let fake = Arc::new(
        FakeGitHub::default().with_list_error(GitHubPortError::Request {
            status: 503,
            message: "server error".into(),
        }),
    );
    let harness = setup(fake).await;
    let ctx = &harness.ctx;
    link_project(ctx, "p1").await;

    let err = pairing::list_remote_issues(ctx, "p1").await.unwrap_err();

    assert!(matches!(err, PairingError::Port(_)));
}
