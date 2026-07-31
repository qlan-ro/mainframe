use axum::extract::{Json, Path};
use axum::http::StatusCode;
use serde_json::{Value, json};

use crate::db_context::text;
use crate::todos;
use crate::todos_github::schema::run_github_migrations;
use crate::todos_github::store;
use crate::todos_github::touch;
use crate::todos_github::touch::read_touch;

async fn setup() -> todos::tests::Harness {
    let h = todos::tests::setup().await;
    run_github_migrations(&h.ctx).await.unwrap();
    h
}

async fn create(h: &todos::tests::Harness) -> Value {
    todos::tests::create_todo(
        h,
        json!({ "projectId": "p1", "title": "Original", "body": "Original body" }),
    )
    .await
}

async fn patch(h: &todos::tests::Harness, id: &str, body: Value) -> StatusCode {
    let (status, _) = todos::tests::read(
        todos::patch_todo(todos::tests::state(h), Path(id.to_string()), Json(body)).await,
    )
    .await;
    status
}

async fn move_status(h: &todos::tests::Harness, id: &str, status: &str) -> StatusCode {
    let (code, _) = todos::tests::read(
        todos::move_todo(
            todos::tests::state(h),
            Path(id.to_string()),
            Json(json!({ "status": status })),
        )
        .await,
    )
    .await;
    code
}

async fn updated_at(h: &todos::tests::Harness, id: &str) -> String {
    let row = h
        .ctx
        .db
        .query_one(
            "SELECT updated_at FROM todos WHERE id = ?".into(),
            vec![text(id.to_string())],
        )
        .await
        .unwrap()
        .unwrap();
    row.get("updated_at")
        .and_then(Value::as_str)
        .unwrap()
        .to_string()
}

#[tokio::test]
async fn creating_a_todo_stamps_title_body_and_state() {
    let h = setup().await;
    let todo = create(&h).await;
    let id = todo["id"].as_str().unwrap();
    let touch = read_touch(&h.ctx, id).await.unwrap();
    for field in ["title", "body", "state"] {
        assert!(
            touch.contains_key(field),
            "{field} should be stamped on create"
        );
    }
}

#[tokio::test]
async fn patch_changing_title_stamps_only_title() {
    let h = setup().await;
    let todo = create(&h).await;
    let id = todo["id"].as_str().unwrap().to_string();
    let before = read_touch(&h.ctx, &id).await.unwrap();

    assert_eq!(
        patch(&h, &id, json!({ "title": "Changed" })).await,
        StatusCode::OK
    );

    let after = read_touch(&h.ctx, &id).await.unwrap();
    assert_ne!(after["title"], before["title"], "title's stamp advances");
    assert_eq!(after["body"], before["body"], "body is untouched");
    assert_eq!(after["state"], before["state"], "state is untouched");
}

#[tokio::test]
async fn patch_rewriting_the_held_value_stamps_nothing() {
    let h = setup().await;
    let todo = create(&h).await;
    let id = todo["id"].as_str().unwrap().to_string();
    let before = read_touch(&h.ctx, &id).await.unwrap();

    assert_eq!(
        patch(&h, &id, json!({ "title": "Original" })).await,
        StatusCode::OK
    );

    let after = read_touch(&h.ctx, &id).await.unwrap();
    assert_eq!(after, before, "rewriting the held value stamps nothing");
}

#[tokio::test]
async fn patch_changing_only_workflow_labels_stamps_nothing() {
    let h = setup().await;
    let todo = create(&h).await;
    let id = todo["id"].as_str().unwrap().to_string();
    let before = read_touch(&h.ctx, &id).await.unwrap();

    assert_eq!(
        patch(&h, &id, json!({ "labels": ["route:full", "needs-triage"] })).await,
        StatusCode::OK
    );

    let after = read_touch(&h.ctx, &id).await.unwrap();
    assert_eq!(after, before, "labels are not a tracked field");
}

#[tokio::test]
async fn patch_changing_only_priority_milestone_assignees_stamps_nothing() {
    let h = setup().await;
    let todo = create(&h).await;
    let id = todo["id"].as_str().unwrap().to_string();
    let before = read_touch(&h.ctx, &id).await.unwrap();

    assert_eq!(
        patch(
            &h,
            &id,
            json!({ "priority": "critical", "milestone": "v2", "assignees": ["dora"] }),
        )
        .await,
        StatusCode::OK
    );

    let after = read_touch(&h.ctx, &id).await.unwrap();
    assert_eq!(after, before);
}

#[tokio::test]
async fn workflow_label_patch_advances_updated_at_but_stamps_nothing() {
    let h = setup().await;
    let todo = create(&h).await;
    let id = todo["id"].as_str().unwrap().to_string();
    let touch_before = read_touch(&h.ctx, &id).await.unwrap();
    let updated_before = updated_at(&h, &id).await;

    assert_eq!(
        patch(&h, &id, json!({ "labels": ["route:full"] })).await,
        StatusCode::OK
    );

    let touch_after = read_touch(&h.ctx, &id).await.unwrap();
    let updated_after = updated_at(&h, &id).await;
    assert_eq!(
        touch_after, touch_before,
        "the touch map does not mirror updated_at"
    );
    assert_ne!(
        updated_after, updated_before,
        "the row's own updated_at still advances"
    );
}

#[tokio::test]
async fn move_between_open_and_in_progress_stamps_nothing() {
    let h = setup().await;
    let todo = create(&h).await;
    let id = todo["id"].as_str().unwrap().to_string();
    let before = read_touch(&h.ctx, &id).await.unwrap();

    assert_eq!(move_status(&h, &id, "in_progress").await, StatusCode::OK);

    let after = read_touch(&h.ctx, &id).await.unwrap();
    assert_eq!(
        after["state"], before["state"],
        "open -> in_progress is invisible"
    );
}

#[tokio::test]
async fn move_to_done_and_back_stamps_state() {
    // Pin a known-old stamp before each move and assert it advanced, rather
    // than diffing two wall-clock reads: `now_iso8601()` is millisecond
    // precision, so two `move_status` calls back-to-back can land in the
    // same millisecond and make the stamps byte-identical.
    const OLD_STAMP: &str = "2020-01-01T00:00:00.000Z";

    let h = setup().await;
    let todo = create(&h).await;
    let id = todo["id"].as_str().unwrap().to_string();

    touch::stamp_create(&h.ctx, &id, OLD_STAMP).await.unwrap();
    assert_eq!(move_status(&h, &id, "done").await, StatusCode::OK);
    let after_done = read_touch(&h.ctx, &id).await.unwrap();
    assert_ne!(
        after_done["state"], OLD_STAMP,
        "crossing into done stamps state"
    );

    touch::stamp_create(&h.ctx, &id, OLD_STAMP).await.unwrap();
    assert_eq!(move_status(&h, &id, "open").await, StatusCode::OK);
    let after_reopen = read_touch(&h.ctx, &id).await.unwrap();
    assert_ne!(
        after_reopen["state"], OLD_STAMP,
        "crossing out of done stamps state again"
    );
}

#[tokio::test]
async fn deleting_a_todo_cascades_the_pair_and_the_touch_map() {
    let h = setup().await;
    let todo = create(&h).await;
    let id = todo["id"].as_str().unwrap().to_string();
    store::insert_pair(
        &h.ctx,
        &store::Pair {
            todo_id: id.clone(),
            project_id: "p1".to_string(),
            owner: "acme".to_string(),
            repo: "widgets".to_string(),
            issue_number: 1,
            issue_url: "https://github.com/acme/widgets/issues/1".to_string(),
            pair_state: "clean".to_string(),
            state_reason: None,
            base_title: "Original".to_string(),
            base_body: "Original body".to_string(),
            base_state: "open".to_string(),
            base_labels: vec![],
            base_at: "2026-07-31T00:00:00Z".to_string(),
            created_at: "2026-07-31T00:00:00Z".to_string(),
        },
    )
    .await
    .unwrap();
    assert!(!read_touch(&h.ctx, &id).await.unwrap().is_empty());

    todos::delete_todo(todos::tests::state(&h), Path(id.clone())).await;

    assert!(
        store::read_pair_by_todo(&h.ctx, &id)
            .await
            .unwrap()
            .is_none()
    );
    assert!(read_touch(&h.ctx, &id).await.unwrap().is_empty());
}
