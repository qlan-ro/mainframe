//! The handler test harness (a real plugin context on a temp dir with a fake
//! host database) plus the list/create tests. Sibling test modules and the
//! GitHub sync tests reuse the harness.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::body::to_bytes;
use axum::extract::{Json, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use mainframe_types::events::DaemonEvent;
use mainframe_types::plugin::PluginCapability;
use serde_json::{Value, json};

use super::routes::{get_todos, post_todo};
use super::tests_support::{FakeHostDb, build_context};
use crate::context::PluginContext;

pub(crate) struct Harness {
    _dir: tempfile::TempDir,
    pub(crate) ctx: Arc<PluginContext>,
    pub(super) host: Arc<FakeHostDb>,
    pub(super) events: Arc<Mutex<Vec<DaemonEvent>>>,
}

pub(crate) async fn setup() -> Harness {
    setup_with_settings(&[]).await
}

pub(super) async fn setup_with_settings(settings: &[((&str, &str), &str)]) -> Harness {
    let dir = tempfile::tempdir().unwrap();
    let host = Arc::new(FakeHostDb::default());
    for ((cat, key), value) in settings {
        host.settings
            .lock()
            .unwrap()
            .insert((cat.to_string(), key.to_string()), value.to_string());
    }
    let capabilities = vec![
        PluginCapability::Storage,
        PluginCapability::ChatCreate,
        PluginCapability::UiPanels,
    ];
    let (ctx, events) = build_context(dir.path(), capabilities, Arc::clone(&host));
    super::migrations::run(&ctx).await.unwrap();
    Harness {
        _dir: dir,
        ctx,
        host,
        events,
    }
}

pub(crate) async fn read(resp: Response) -> (StatusCode, Value) {
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

pub(crate) fn state(h: &Harness) -> State<Arc<PluginContext>> {
    State(Arc::clone(&h.ctx))
}

pub(crate) async fn create_todo(h: &Harness, body: Value) -> Value {
    let (status, out) = read(post_todo(state(h), Json(body)).await).await;
    assert_eq!(status, StatusCode::CREATED);
    out["todo"].clone()
}

pub(super) async fn list_todos(h: &Harness, project_id: &str) -> (StatusCode, Value) {
    let query = Query(HashMap::from([(
        "projectId".to_string(),
        project_id.to_string(),
    )]));
    read(get_todos(state(h), query).await).await
}

pub(super) fn notifications(h: &Harness) -> Vec<Value> {
    h.events
        .lock()
        .unwrap()
        .iter()
        .filter_map(|e| match e {
            DaemonEvent::PluginNotification {
                title, body, level, ..
            } => Some(json!({ "title": title, "body": body, "level": level })),
            _ => None,
        })
        .collect()
}

pub(super) fn id_of(todo: &Value) -> String {
    todo["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn get_returns_400_when_project_id_missing() {
    let h = setup().await;
    let (status, body) = read(get_todos(state(&h), Query(HashMap::new())).await).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, json!({ "error": "projectId required" }));
}

#[tokio::test]
async fn get_returns_empty_for_project_with_no_todos() {
    let h = setup().await;
    let (status, body) = list_todos(&h, "p1").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "todos": [] }));
}

#[tokio::test]
async fn create_assigns_defaults_and_number_one() {
    let h = setup().await;
    let todo = create_todo(&h, json!({ "projectId": "p1", "title": "First task" })).await;
    assert_eq!(todo["number"], json!(1));
    assert_eq!(todo["project_id"], json!("p1"));
    assert_eq!(todo["title"], json!("First task"));
    assert_eq!(todo["body"], json!(""));
    assert_eq!(todo["status"], json!("open"));
    assert_eq!(todo["type"], json!("feature"));
    assert_eq!(todo["priority"], json!("medium"));
    assert_eq!(todo["labels"], json!([]));
    assert_eq!(todo["assignees"], json!([]));
    assert_eq!(todo["dependencies"], json!([]));
    assert!(todo["id"].is_string());
}

#[tokio::test]
async fn create_bug_type_persists() {
    let h = setup().await;
    let todo = create_todo(
        &h,
        json!({ "projectId": "proj-1", "title": "Fix login bug", "type": "bug" }),
    )
    .await;
    assert_eq!(todo["type"], json!("bug"));
    assert_eq!(todo["status"], json!("open"));
}

#[tokio::test]
async fn create_increments_per_project_number() {
    let h = setup().await;
    create_todo(&h, json!({ "projectId": "p1", "title": "First" })).await;
    let second = create_todo(&h, json!({ "projectId": "p1", "title": "Second" })).await;
    assert_eq!(second["number"], json!(2));
}

#[tokio::test]
async fn create_400_when_title_missing() {
    let h = setup().await;
    let (status, body) = read(post_todo(state(&h), Json(json!({ "projectId": "p1" }))).await).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, json!({ "error": "Invalid input" }));
}

#[tokio::test]
async fn create_400_for_invalid_status_enum() {
    let h = setup().await;
    let resp = post_todo(
        state(&h),
        Json(json!({ "projectId": "p1", "title": "x", "status": "bogus" })),
    )
    .await;
    let (status, body) = read(resp).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, json!({ "error": "Invalid input" }));
}

#[tokio::test]
async fn create_400_for_non_string_labels_but_accepts_null_fields() {
    let h = setup().await;
    let resp = post_todo(
        state(&h),
        Json(json!({ "projectId": "p1", "title": "x", "labels": ["ok", 1] })),
    )
    .await;
    assert_eq!(read(resp).await.0, StatusCode::BAD_REQUEST);

    let todo = create_todo(
        &h,
        json!({ "projectId": "p1", "title": "x", "status": null, "labels": null, "body": null, "milestone": null }),
    )
    .await;
    assert_eq!(todo["status"], json!("open"));
    assert_eq!(todo["labels"], json!([]));
    assert_eq!(todo["body"], json!(""));
    assert_eq!(todo["milestone"], Value::Null);
}

/// The wire object is the raw row: snake_case column names, `type`, a REAL
/// `order_index`, and `milestone` present as `null` when unset.
#[tokio::test]
async fn created_todo_wire_shape_is_the_raw_row() {
    let h = setup().await;
    let mut todo = create_todo(
        &h,
        json!({
            "projectId": "p1", "title": "Golden", "body": "Body", "type": "bug",
            "priority": "high", "labels": ["a"], "assignees": ["me"],
            "milestone": "v1", "dependencies": [7],
        }),
    )
    .await;
    assert!(todo["id"].is_string());
    assert!(todo["created_at"].is_string() && todo["created_at"] == todo["updated_at"]);
    todo["id"] = json!("<id>");
    todo["created_at"] = json!("<at>");
    todo["updated_at"] = json!("<at>");
    assert_eq!(
        todo,
        json!({
            "id": "<id>", "number": 1, "project_id": "p1", "title": "Golden",
            "body": "Body", "status": "open", "type": "bug", "priority": "high",
            "labels": ["a"], "assignees": ["me"], "milestone": "v1",
            "dependencies": [7], "order_index": 0.0,
            "created_at": "<at>", "updated_at": "<at>",
        })
    );

    let (_, listed) = list_todos(&h, "p1").await;
    let mut listed = listed["todos"][0].clone();
    listed["id"] = json!("<id>");
    listed["created_at"] = json!("<at>");
    listed["updated_at"] = json!("<at>");
    assert_eq!(listed, todo);
}
