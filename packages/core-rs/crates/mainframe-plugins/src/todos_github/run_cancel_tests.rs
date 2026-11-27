//! A sync whose request is dropped mid-run releases the project's run slot.

use std::sync::Arc;
use std::time::Duration;

use crate::github_port::IssueState;
use crate::todos_github::fake_github::FakeGitHub;
use crate::todos_github::run::{is_running, run_sync};
use crate::todos_github::run_test_support::{insert_pair, insert_todo, issue, link_project};
use crate::todos_github::test_support::setup;

#[tokio::test]
async fn a_dropped_run_releases_the_project() {
    let project = "p-cancel";
    let fake = Arc::new(FakeGitHub::default().with_issue(issue(
        42,
        "Title",
        "body",
        IssueState::Open,
        &[],
    )));
    let harness = setup(fake).await;
    let ctx = &harness.ctx;
    insert_todo(ctx, "t1", project, "Title", "body", "open", &[]).await;
    link_project(ctx, project).await;
    insert_pair(
        ctx,
        "t1",
        project,
        42,
        "2026-01-01T00:00:00Z",
        "Title",
        "body",
        "open",
        &[],
    )
    .await;

    let mut run = Box::pin(run_sync(ctx, project));
    assert!(
        tokio::time::timeout(Duration::ZERO, &mut run)
            .await
            .is_err(),
        "the run waits on its database worker at least once"
    );
    assert!(is_running(project));

    drop(run);
    assert!(!is_running(project), "dropping the run frees the slot");
    run_sync(ctx, project)
        .await
        .expect("a new run starts after the dropped one");
}
