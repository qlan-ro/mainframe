//! Start-session, attachments, the schema migration, and the storage guard.

use std::sync::Arc;

use axum::extract::{Json, Path};
use axum::http::StatusCode;
use mainframe_types::events::DaemonEvent;
use mainframe_types::plugin::PluginCapability;
use serde_json::{Value, json};

use super::attachments::post_attachment;
use super::routes::start_session;
use super::tests::{create_todo, id_of, read, setup, setup_with_settings, state};
use super::tests_support::{FakeHostDb, build_context};
use super::{activate, migrations};
use crate::PluginError;

#[tokio::test]
async fn start_session_404_for_missing() {
    let h = setup().await;
    let resp = start_session(
        state(&h),
        Path("missing".to_string()),
        Json(json!({ "projectId": "p1" })),
    )
    .await;
    let (status, body) = read(resp).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, json!({ "error": "Not found" }));
}

#[tokio::test]
async fn start_session_400_when_project_id_missing() {
    let h = setup().await;
    let id = id_of(&create_todo(&h, json!({ "projectId": "p1", "title": "T" })).await);
    let resp = start_session(state(&h), Path(id), Json(json!({}))).await;
    let (status, body) = read(resp).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, json!({ "error": "projectId required" }));
}

#[tokio::test]
async fn start_session_creates_chat_and_message() {
    let h = setup().await;
    let id = id_of(
        &create_todo(
            &h,
            json!({ "projectId": "p1", "title": "Ship it", "body": "Do the thing", "labels": ["urgent"] }),
        )
        .await,
    );
    let resp = start_session(state(&h), Path(id), Json(json!({ "projectId": "p1" }))).await;
    let (status, body) = read(resp).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["chatId"], json!("chat-1"));
    assert_eq!(
        body["initialMessage"],
        json!(
            "**#1 Ship it**\nType: Feature | Priority: Medium | Labels: urgent\n\n## Description\nDo the thing"
        )
    );
    assert_eq!(
        h.host.created.lock().unwrap().as_slice(),
        [("p1".to_string(), "claude".to_string(), None, None)]
    );
    // chat.created emitted by the chat service.
    assert!(
        h.events
            .lock()
            .unwrap()
            .iter()
            .any(|e| matches!(e, DaemonEvent::ChatCreated { .. }))
    );
}

#[tokio::test]
async fn start_session_lists_milestone_and_dependencies() {
    let h = setup().await;
    create_todo(&h, json!({ "projectId": "p1", "title": "Dep" })).await;
    let id = id_of(
        &create_todo(
            &h,
            json!({ "projectId": "p1", "title": "Main", "milestone": "v2", "dependencies": [1, 99] }),
        )
        .await,
    );
    let resp = start_session(state(&h), Path(id), Json(json!({ "projectId": "p1" }))).await;
    let (_, body) = read(resp).await;
    assert_eq!(
        body["initialMessage"],
        json!(
            "**#2 Main**\nType: Feature | Priority: Medium | Labels: none\nMilestone: v2\nDependencies: #1 Dep (open)"
        )
    );
}

#[tokio::test]
async fn start_session_reads_provider_defaults() {
    let h = setup_with_settings(&[
        (("provider", "claude.defaultModel"), "opus"),
        (("provider", "claude.defaultMode"), "plan"),
    ])
    .await;
    let id = id_of(&create_todo(&h, json!({ "projectId": "p1", "title": "Big feature" })).await);
    let resp = start_session(state(&h), Path(id), Json(json!({ "projectId": "p1" }))).await;
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        h.host.created.lock().unwrap().as_slice(),
        [(
            "p1".to_string(),
            "claude".to_string(),
            Some("opus".to_string()),
            Some("plan".to_string())
        )]
    );
}

#[tokio::test]
async fn attachment_400_when_filename_or_data_missing() {
    let h = setup().await;
    let id = id_of(&create_todo(&h, json!({ "projectId": "p1", "title": "A" })).await);
    for body in [
        json!({ "data": "base64data" }),
        json!({ "filename": "file.txt" }),
        json!({ "filename": "file.txt", "data": "", "sizeBytes": -1 }),
    ] {
        let resp = post_attachment(state(&h), Path(id.clone()), Json(body.clone())).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST, "{body}");
    }
}

#[tokio::test]
async fn attachment_accepts_zero_byte_file() {
    let h = setup().await;
    let id = id_of(&create_todo(&h, json!({ "projectId": "p1", "title": "A" })).await);
    let resp = post_attachment(
        state(&h),
        Path(id),
        Json(json!({ "filename": "empty.txt", "data": "", "sizeBytes": 0 })),
    )
    .await;
    let (status, body) = read(resp).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["attachment"]["filename"], json!("empty.txt"));
    assert_eq!(
        body["attachment"]["mimeType"],
        json!("application/octet-stream")
    );
}

/// A database the previous ad-hoc runner created (no `user_version`, the
/// base table without the later columns) gains the columns, sequential
/// numbers in creation order, the GitHub tables, and a schema version; a
/// second run is a no-op.
#[tokio::test]
async fn legacy_database_converges_to_schema_version_one() {
    let dir = tempfile::tempdir().unwrap();
    let legacy = rusqlite::Connection::open(dir.path().join("data.db")).unwrap();
    legacy
        .execute_batch(
            "CREATE TABLE todos (
               id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
               status TEXT NOT NULL DEFAULT 'open', type TEXT NOT NULL DEFAULT 'feature',
               priority TEXT NOT NULL DEFAULT 'medium', labels TEXT NOT NULL DEFAULT '[]',
               assignees TEXT NOT NULL DEFAULT '[]', milestone TEXT,
               order_index REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             INSERT INTO todos (id, title, created_at, updated_at)
               VALUES ('later', 'Later', '2024-02-01T00:00:00Z', '2024-02-01T00:00:00Z');
             INSERT INTO todos (id, title, created_at, updated_at)
               VALUES ('earlier', 'Earlier', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z');",
        )
        .unwrap();
    drop(legacy);
    let (ctx, _) = build_context(
        dir.path(),
        vec![PluginCapability::Storage],
        Arc::new(FakeHostDb::default()),
    );

    migrations::run(&ctx).await.unwrap();
    migrations::run(&ctx).await.unwrap();

    let rows = ctx
        .db
        .query_all(
            "SELECT id, number, project_id, dependencies FROM todos ORDER BY number".into(),
            vec![],
        )
        .await
        .unwrap();
    assert_eq!(
        rows.into_iter().map(Value::Object).collect::<Vec<_>>(),
        vec![
            json!({ "id": "earlier", "number": 1, "project_id": "", "dependencies": "[]" }),
            json!({ "id": "later", "number": 2, "project_id": "", "dependencies": "[]" }),
        ]
    );
    let tables = ctx
        .db
        .query_all(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'github_%' ORDER BY name".into(),
            vec![],
        )
        .await
        .unwrap();
    assert_eq!(
        tables
            .iter()
            .map(|row| row["name"].clone())
            .collect::<Vec<_>>(),
        vec![
            json!("github_links"),
            json!("github_pairs"),
            json!("github_report_rows"),
            json!("github_runs"),
            json!("github_touch"),
        ]
    );
    let version = ctx
        .db
        .query_one("PRAGMA user_version".into(), vec![])
        .await
        .unwrap()
        .unwrap();
    assert_eq!(version["user_version"], json!(1));
}

/// Without `storage` the typed repo and the migrations hit the capability
/// guard, so activation fails before any database file exists.
#[tokio::test]
async fn activate_without_storage_is_rejected_by_the_guard() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, _) = build_context(
        dir.path(),
        vec![PluginCapability::UiPanels],
        Arc::new(FakeHostDb::default()),
    );
    let err = activate(ctx).await.unwrap_err();
    assert!(matches!(&err, PluginError::CapabilityRequired(cap) if cap == "storage"));
    assert_eq!(
        err.to_string(),
        "Plugin capability 'storage' is required but not declared in manifest"
    );
    assert!(!dir.path().join("data.db").exists());
}
