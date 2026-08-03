use serde_json::json;

use crate::db_context::text;
use crate::todos;
use crate::todos_github::schema::run_github_migrations;

use super::setup;

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
