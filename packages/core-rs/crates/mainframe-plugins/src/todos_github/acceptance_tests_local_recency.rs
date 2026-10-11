//! AC14: a write that changes only workflow labels leaves every tracked
//! local change time untouched. The test fails if the implementation reads
//! the task row's general `updated_at` as the local clock: it seeds a body
//! that genuinely diverged from the baseline back in January, then issues a
//! label-only patch (today, per `now_iso8601()`) that bumps `updated_at`
//! without touching the tracked recency. A remote body change dated between
//! the two must still win — a `todos.updated_at`-based reader would instead
//! see today's date and keep the stale local body.

use std::sync::Arc;

use axum::extract::{Json, Path};
use serde_json::json;

use crate::db_context::text;
use crate::github_port::{IssueSnapshot, IssueState};
use crate::todos::patch_todo;
use crate::todos_github::fake_github::FakeGitHub;
use crate::todos_github::routes::sync;
use crate::todos_github::run_test_support::{insert_pair, insert_todo, link_project};
use crate::todos_github::test_support;

use super::{read, todo_field};

#[tokio::test]
async fn ac14_a_workflow_label_only_write_never_advances_the_tracked_local_recency() {
    let remote = IssueSnapshot {
        number: 10,
        title: "Title".to_string(),
        body: "Remote body".to_string(),
        labels: vec![],
        state: IssueState::Open,
        html_url: "https://github.com/acme/widgets/issues/10".to_string(),
        // Between the seeded body touch (Jan 15) and today's real clock
        // (`now_iso8601()`, unavoidably "now" when this test runs) — the
        // only way to make the dispute's outcome depend on which local
        // clock reconcile reads.
        updated_at: "2026-06-01T00:00:00Z".to_string(),
    };
    let fake = Arc::new(FakeGitHub::default().with_issue(remote));
    let h = test_support::setup(fake).await;
    link_project(&h.ctx, "p-ac14").await;
    insert_todo(&h.ctx, "t1", "p-ac14", "Title", "Local body", "open", &[]).await;
    insert_pair(
        &h.ctx,
        "t1",
        "p-ac14",
        10,
        "2026-01-01T00:00:00Z",
        "Title",
        "Old body",
        "open",
        &[],
    )
    .await;
    h.ctx
        .db
        .execute(
            "INSERT INTO github_touch (todo_id, field, changed_at) VALUES (?, 'body', ?)".into(),
            vec![
                text("t1".to_string()),
                text("2026-01-15T00:00:00Z".to_string()),
            ],
        )
        .await
        .unwrap();

    read(
        patch_todo(
            test_support::state(&h),
            Path("t1".to_string()),
            Json(json!({ "labels": ["urgent"] })),
        )
        .await,
    )
    .await;

    read(
        sync::post_sync(
            test_support::state(&h),
            Json(json!({ "projectId": "p-ac14" })),
        )
        .await,
    )
    .await;

    assert_eq!(
        todo_field(&h.ctx, "t1", "body").await.as_deref(),
        Some("Remote body"),
        "the label-only write's inflated updated_at must not make the stale local body look newer"
    );
}
