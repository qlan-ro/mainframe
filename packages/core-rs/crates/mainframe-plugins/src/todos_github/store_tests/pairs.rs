use axum::extract::Path;
use serde_json::json;

use crate::PluginError;
use crate::todos;
use crate::todos_github::store;

use super::{sample_pair, setup};

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
            .is_none(),
        "deleting the todo cascades its pair away (AC24)"
    );
    assert!(
        store::read_pair_by_todo(&h.ctx, &second_id)
            .await
            .unwrap()
            .is_none(),
        "the new todo that reused the number does not inherit the deleted todo's pair"
    );
}
