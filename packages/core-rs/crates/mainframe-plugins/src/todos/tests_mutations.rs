//! Patch, move and delete behaviour, including the notifications they raise.

use axum::extract::{Json, Path};
use axum::http::StatusCode;
use serde_json::{Value, json};

use super::routes::{delete_todo, move_todo, patch_todo};
use super::tests::{Harness, create_todo, id_of, list_todos, notifications, read, setup, state};
use crate::db_context::text;

async fn patch(h: &Harness, id: &str, body: Value) -> (StatusCode, Value) {
    read(patch_todo(state(h), Path(id.to_string()), Json(body)).await).await
}

async fn move_to(h: &Harness, id: &str, body: Value) -> (StatusCode, Value) {
    read(move_todo(state(h), Path(id.to_string()), Json(body)).await).await
}

#[tokio::test]
async fn patch_404_for_missing() {
    let h = setup().await;
    let (status, body) = patch(&h, "missing", json!({ "title": "x" })).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, json!({ "error": "Not found" }));
}

#[tokio::test]
async fn patch_title_without_notifying() {
    let h = setup().await;
    let id = id_of(&create_todo(&h, json!({ "projectId": "p1", "title": "T" })).await);
    let (status, body) = patch(&h, &id, json!({ "title": "Renamed" })).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["todo"]["title"], json!("Renamed"));
    assert!(notifications(&h).is_empty());
}

#[tokio::test]
async fn patch_rejects_empty_title_wrong_types_and_unknown_enums() {
    let h = setup().await;
    let id = id_of(&create_todo(&h, json!({ "projectId": "p1", "title": "T" })).await);
    for body in [
        json!({ "title": "" }),
        json!({ "body": 5 }),
        json!({ "priority": "urgent" }),
        json!({ "labels": "x" }),
        json!({ "dependencies": [1.5] }),
    ] {
        let (status, out) = patch(&h, &id, body.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(out, json!({ "error": "Invalid input" }));
    }
}

#[tokio::test]
async fn patch_null_fields_are_left_untouched() {
    let h = setup().await;
    let created = create_todo(
        &h,
        json!({ "projectId": "p1", "title": "T", "labels": ["keep"], "milestone": "m1" }),
    )
    .await;
    let (status, body) = patch(
        &h,
        &id_of(&created),
        json!({ "labels": null, "milestone": null, "title": null }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["todo"]["labels"], json!(["keep"]));
    assert_eq!(body["todo"]["milestone"], json!("m1"));
    assert_eq!(body["todo"]["title"], json!("T"));
}

#[tokio::test]
async fn patch_notifies_on_status_change() {
    let h = setup().await;
    let id = id_of(&create_todo(&h, json!({ "projectId": "p1", "title": "T" })).await);
    let (status, body) = patch(&h, &id, json!({ "status": "in_progress" })).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["todo"]["status"], json!("in_progress"));
    assert_eq!(
        notifications(&h),
        vec![json!({ "title": "#1 T", "body": "Moved to In Progress", "level": "success" })]
    );
}

#[tokio::test]
async fn move_400_for_invalid_status() {
    let h = setup().await;
    let (status, body) = move_to(&h, "x", json!({ "status": "bogus" })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, json!({ "error": "Invalid status" }));
}

#[tokio::test]
async fn move_404_when_absent() {
    let h = setup().await;
    let (status, body) = move_to(&h, "missing", json!({ "status": "done" })).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, json!({ "error": "Not found" }));
}

#[tokio::test]
async fn move_changes_status() {
    let h = setup().await;
    let id = id_of(&create_todo(&h, json!({ "projectId": "proj-1", "title": "Test" })).await);
    let (status, body) = move_to(&h, &id, json!({ "status": "in_progress" })).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["todo"]["status"], json!("in_progress"));
}

#[tokio::test]
async fn move_warns_on_open_dependencies() {
    let h = setup().await;
    let dep = create_todo(&h, json!({ "projectId": "p1", "title": "Dep" })).await;
    let dep_num = dep["number"].as_i64().unwrap();
    let main = create_todo(
        &h,
        json!({ "projectId": "p1", "title": "Main", "dependencies": [dep_num] }),
    )
    .await;
    let (status, body) = move_to(&h, &id_of(&main), json!({ "status": "done" })).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["todo"]["status"], json!("done"));
    assert_eq!(
        notifications(&h),
        vec![json!({
            "title": "#2 Main has open dependencies",
            "body": "#1 Dep",
            "level": "warning",
        })]
    );
}

#[tokio::test]
async fn delete_returns_204_and_removes() {
    let h = setup().await;
    let id = id_of(&create_todo(&h, json!({ "projectId": "p1", "title": "T" })).await);
    let resp = delete_todo(state(&h), Path(id)).await;
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    let (_, body) = list_todos(&h, "p1").await;
    assert_eq!(body["todos"], json!([]));
}

#[tokio::test]
async fn get_tolerates_malformed_json_columns() {
    let h = setup().await;
    create_todo(
        &h,
        json!({ "projectId": "proj-1", "title": "Good todo", "labels": ["ok"] }),
    )
    .await;
    let bad = create_todo(
        &h,
        json!({ "projectId": "proj-1", "title": "Corrupt todo" }),
    )
    .await;
    let bad_id = id_of(&bad);
    // Simulate the historical double-encoded value seen in production data.
    h.ctx
        .db
        .execute(
            "UPDATE todos SET labels = ? WHERE id = ?".into(),
            vec![
                text(r#"[\"workflows\",\"design\"]"#.to_string()),
                text(bad_id.clone()),
            ],
        )
        .await
        .unwrap();
    let (status, body) = list_todos(&h, "proj-1").await;
    assert_eq!(status, StatusCode::OK);
    let todos = body["todos"].as_array().unwrap();
    assert_eq!(todos.len(), 2);
    let corrupt = todos.iter().find(|t| t["id"] == json!(bad_id)).unwrap();
    assert_eq!(corrupt["labels"], json!([]));
    let good = todos
        .iter()
        .find(|t| t["title"] == json!("Good todo"))
        .unwrap();
    assert_eq!(good["labels"], json!(["ok"]));
}
