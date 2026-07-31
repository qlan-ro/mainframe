use axum::extract::Path;
use mainframe_runtime::time::now_iso8601;
use serde_json::json;

use crate::PluginError;
use crate::db_context::text;
use crate::todos;
use crate::todos_github::schema::run_github_migrations;
use crate::todos_github::store::{self, Link, Pair, ReportRow, Run as StoreRun};

/// A fresh todos+github db, migrated for both plugin surfaces.
async fn setup() -> todos::tests::Harness {
    let h = todos::tests::setup().await;
    run_github_migrations(&h.ctx).await.unwrap();
    h
}

fn sample_link(project_id: &str) -> Link {
    Link {
        project_id: project_id.to_string(),
        owner: "acme".to_string(),
        repo: "widgets".to_string(),
        remote_name: "origin".to_string(),
        credential_label: "github".to_string(),
        last_synced_at: None,
        created_at: now_iso8601(),
    }
}

fn sample_pair(todo_id: &str, project_id: &str, issue_number: i64) -> Pair {
    Pair {
        todo_id: todo_id.to_string(),
        project_id: project_id.to_string(),
        owner: "acme".to_string(),
        repo: "widgets".to_string(),
        issue_number,
        issue_url: format!("https://github.com/acme/widgets/issues/{issue_number}"),
        pair_state: "clean".to_string(),
        state_reason: None,
        base_title: "Title".to_string(),
        base_body: "Body".to_string(),
        base_state: "open".to_string(),
        base_labels: vec!["bug".to_string()],
        base_at: now_iso8601(),
        created_at: now_iso8601(),
    }
}

#[tokio::test]
async fn migration_creates_every_table_on_a_fresh_db() {
    let h = setup().await;
    let rows = h
        .ctx
        .db
        .query_all(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'github_%'".into(),
            vec![],
        )
        .await
        .unwrap();
    let names: Vec<String> = rows
        .into_iter()
        .filter_map(|r| r.get("name").and_then(|v| v.as_str().map(str::to_string)))
        .collect();
    for table in [
        "github_links",
        "github_pairs",
        "github_touch",
        "github_runs",
        "github_report_rows",
    ] {
        assert!(names.contains(&table.to_string()), "missing table {table}");
    }
}

#[tokio::test]
async fn migration_is_additive_over_preexisting_todos() {
    // todos::tests::setup() already runs the github migration (task 9 wires it
    // into todos::run_migrations), so re-running it here exercises the same
    // "migration already ran, todos already exist" case AC31 requires.
    let h = todos::tests::setup().await;
    todos::tests::create_todo(&h, json!({ "projectId": "p1", "title": "Existing" })).await;
    run_github_migrations(&h.ctx).await.unwrap();
    let rows = h
        .ctx
        .db
        .query_all(
            "SELECT id FROM todos WHERE project_id = ?".into(),
            vec![text("p1".to_string())],
        )
        .await
        .unwrap();
    assert_eq!(
        rows.len(),
        1,
        "pre-existing todos survive the additive migration"
    );
}

#[tokio::test]
async fn migration_is_idempotent() {
    let h = setup().await;
    run_github_migrations(&h.ctx).await.unwrap();
    run_github_migrations(&h.ctx).await.unwrap();
}

#[tokio::test]
async fn link_upsert_read_delete() {
    let h = setup().await;
    store::insert_link(&h.ctx, &sample_link("p1"))
        .await
        .unwrap();
    let read = store::read_link(&h.ctx, "p1").await.unwrap().unwrap();
    assert_eq!(read.owner, "acme");
    assert_eq!(read.repo, "widgets");
    assert_eq!(read.last_synced_at, None);

    let mut updated = sample_link("p1");
    updated.repo = "gadgets".to_string();
    store::insert_link(&h.ctx, &updated).await.unwrap();
    let read = store::read_link(&h.ctx, "p1").await.unwrap().unwrap();
    assert_eq!(
        read.repo, "gadgets",
        "a second insert upserts the single row"
    );

    store::delete_link(&h.ctx, "p1").await.unwrap();
    assert!(store::read_link(&h.ctx, "p1").await.unwrap().is_none());
}

#[tokio::test]
async fn link_read_returns_none_when_absent() {
    let h = setup().await;
    assert!(store::read_link(&h.ctx, "missing").await.unwrap().is_none());
}

#[tokio::test]
async fn pair_insert_and_read_by_todo_and_issue() {
    let h = setup().await;
    store::insert_pair(&h.ctx, &sample_pair("todo-1", "p1", 42))
        .await
        .unwrap();

    let by_todo = store::read_pair_by_todo(&h.ctx, "todo-1")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(by_todo.issue_number, 42);
    assert_eq!(by_todo.base_labels, vec!["bug".to_string()]);

    let by_issue = store::read_pair_by_issue(&h.ctx, "p1", "acme", "widgets", 42)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(by_issue.todo_id, "todo-1");
}

#[tokio::test]
async fn pair_read_by_todo_returns_none_when_absent() {
    let h = setup().await;
    assert!(
        store::read_pair_by_todo(&h.ctx, "missing")
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn duplicate_issue_pairing_is_rejected() {
    let h = setup().await;
    store::insert_pair(&h.ctx, &sample_pair("todo-1", "p1", 42))
        .await
        .unwrap();
    let err = store::insert_pair(&h.ctx, &sample_pair("todo-2", "p1", 42))
        .await
        .unwrap_err();
    assert!(matches!(err, PluginError::Sqlite(_)));
}

#[tokio::test]
async fn baseline_read_and_write() {
    let h = setup().await;
    store::insert_pair(&h.ctx, &sample_pair("todo-1", "p1", 42))
        .await
        .unwrap();
    store::write_baseline(
        &h.ctx,
        "todo-1",
        "New title",
        "New body",
        "closed",
        &["feature".to_string()],
        "2026-07-31T00:00:00Z",
    )
    .await
    .unwrap();
    let pair = store::read_pair_by_todo(&h.ctx, "todo-1")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(pair.base_title, "New title");
    assert_eq!(pair.base_body, "New body");
    assert_eq!(pair.base_state, "closed");
    assert_eq!(pair.base_labels, vec!["feature".to_string()]);
    assert_eq!(pair.base_at, "2026-07-31T00:00:00Z");
}

#[tokio::test]
async fn pair_state_transitions() {
    let h = setup().await;
    store::insert_pair(&h.ctx, &sample_pair("todo-1", "p1", 42))
        .await
        .unwrap();

    store::set_pair_state(&h.ctx, "todo-1", "overwritten", None)
        .await
        .unwrap();
    let pair = store::read_pair_by_todo(&h.ctx, "todo-1")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(pair.pair_state, "overwritten");
    assert_eq!(pair.state_reason, None);

    store::set_pair_state(&h.ctx, "todo-1", "errored", Some("network error"))
        .await
        .unwrap();
    let pair = store::read_pair_by_todo(&h.ctx, "todo-1")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(pair.pair_state, "errored");
    assert_eq!(pair.state_reason, Some("network error".to_string()));
}

#[tokio::test]
async fn delete_pair_removes_row() {
    let h = setup().await;
    store::insert_pair(&h.ctx, &sample_pair("todo-1", "p1", 42))
        .await
        .unwrap();
    store::delete_pair(&h.ctx, "todo-1").await.unwrap();
    assert!(
        store::read_pair_by_todo(&h.ctx, "todo-1")
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn renumbering_keeps_the_pair_keyed_on_todo_id() {
    let h = setup().await;
    let first = todos::tests::create_todo(&h, json!({ "projectId": "p1", "title": "First" })).await;
    let first_id = first["id"].as_str().unwrap().to_string();
    let first_number = first["number"].as_i64().unwrap();
    store::insert_pair(&h.ctx, &sample_pair(&first_id, "p1", 7))
        .await
        .unwrap();

    todos::delete_todo(todos::tests::state(&h), Path(first_id.clone())).await;

    let second =
        todos::tests::create_todo(&h, json!({ "projectId": "p1", "title": "Second" })).await;
    let second_id = second["id"].as_str().unwrap().to_string();
    assert_eq!(
        second["number"].as_i64().unwrap(),
        first_number,
        "the number is reused"
    );

    assert!(
        store::read_pair_by_todo(&h.ctx, &first_id)
            .await
            .unwrap()
            .is_some(),
        "the pair still resolves by the original todo_id"
    );
    assert!(
        store::read_pair_by_todo(&h.ctx, &second_id)
            .await
            .unwrap()
            .is_none(),
        "the new todo that reused the number starts unpaired"
    );
}

#[tokio::test]
async fn run_and_report_rows_insert_and_read() {
    let h = setup().await;
    let run = StoreRun {
        id: "run-1".to_string(),
        project_id: "p1".to_string(),
        started_at: now_iso8601(),
        finished_at: now_iso8601(),
        pairs_reconciled: 2,
        reached: 2,
        total: 2,
        failure_kind: None,
        failure_message: None,
    };
    store::insert_run(&h.ctx, &run).await.unwrap();
    let row = ReportRow {
        id: "row-1".to_string(),
        run_id: "run-1".to_string(),
        todo_id: "todo-1".to_string(),
        todo_number: 1,
        todo_title: "Title".to_string(),
        issue_number: 7,
        field: "title".to_string(),
        winner: "github".to_string(),
        rule: "recency".to_string(),
        local_at: Some(now_iso8601()),
        remote_at: Some(now_iso8601()),
        remote_coarse: false,
        winning_value: "New title".to_string(),
        replaced_value: "Old title".to_string(),
    };
    store::insert_report_rows(&h.ctx, &[row]).await.unwrap();

    let latest = store::latest_run(&h.ctx, "p1").await.unwrap().unwrap();
    assert_eq!(latest.id, "run-1");

    let rows = store::read_report(&h.ctx, "run-1").await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].winning_value, "New title");
}

#[tokio::test]
async fn eleven_runs_prune_to_ten() {
    let h = setup().await;
    for i in 0..11 {
        let run = StoreRun {
            id: format!("run-{i}"),
            project_id: "p1".to_string(),
            started_at: now_iso8601(),
            finished_at: now_iso8601(),
            pairs_reconciled: 0,
            reached: 0,
            total: 0,
            failure_kind: None,
            failure_message: None,
        };
        store::insert_run(&h.ctx, &run).await.unwrap();
        store::prune_runs(&h.ctx, "p1", 10).await.unwrap();
    }
    let rows = h
        .ctx
        .db
        .query_all(
            "SELECT id FROM github_runs WHERE project_id = ?".into(),
            vec![text("p1".to_string())],
        )
        .await
        .unwrap();
    assert_eq!(rows.len(), 10);
    let ids: Vec<String> = rows
        .into_iter()
        .filter_map(|r| r.get("id").and_then(|v| v.as_str().map(str::to_string)))
        .collect();
    assert!(
        !ids.contains(&"run-0".to_string()),
        "the oldest run is pruned"
    );
    assert!(ids.contains(&"run-10".to_string()));
}
