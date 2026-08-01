//! Route-level tests for the not-yet-mounted `/api/projects/{id}/skills-cli/…`
//! routes (todo #243, plan Group A — `rust-cli-tests`, task A4; spec AC 9, 10,
//! 14; Decision 2). RED until Group B (`rust-cli-service`) mounts
//! `routes::skills_cli::router()` in `http.rs`. These exercise only paths
//! that never spawn a process: unknown-project 404s and input-validation
//! 400s. Do not stub the routes to make this pass — a router this file
//! can't reach proves nothing about Group B's behavior.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use reqwest::StatusCode;
use serde_json::{Value, json};
use support::{TestServer, spawn_test_server};

async fn get_json(server: &TestServer, path: &str) -> (StatusCode, Value) {
    let res = reqwest::get(server.http_url(path)).await.unwrap();
    let status = res.status();
    (status, res.json().await.unwrap())
}

async fn post_json(server: &TestServer, path: &str, body: Value) -> (StatusCode, Value) {
    let res = reqwest::Client::new()
        .post(server.http_url(path))
        .json(&body)
        .send()
        .await
        .unwrap();
    let status = res.status();
    (status, res.json().await.unwrap())
}

/// A registered project id these tests never get far enough to spawn
/// anything for: every case here fails validation before `resolve_base`
/// would need the path to exist on disk (`effective_path_sync` is a bare DB
/// lookup, never a filesystem stat).
async fn registered_project(server: &TestServer) -> String {
    server
        .create_project("/tmp/skills-cli-route-test-project")
        .await
}

#[tokio::test]
async fn manifest_unknown_project_id_is_404_project_not_found() {
    let server = spawn_test_server(None).await;

    let (status, body) = get_json(&server, "/api/projects/missing/skills-cli/manifest").await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        body,
        json!({ "success": false, "error": "Project not found" })
    );
}

#[tokio::test]
async fn manifest_rejects_a_filesystem_path_in_place_of_a_project_id() {
    let server = spawn_test_server(None).await;

    let (status, body) = get_json(&server, "/api/projects/%2Ftmp/skills-cli/manifest").await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    let rendered = body.to_string();
    assert!(
        !rendered.contains("/tmp"),
        "the failure body must never echo the supplied path: {rendered}"
    );
}

#[tokio::test]
async fn install_rejects_a_local_path_source_with_400_and_the_standard_envelope() {
    let server = spawn_test_server(None).await;
    let id = registered_project(&server).await;

    let (status, body) = post_json(
        &server,
        &format!("/api/projects/{id}/skills-cli/install"),
        json!({ "source": "./local", "skills": ["a"], "scope": "project" }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["success"], json!(false));
    assert!(body["error"].is_string(), "{body:?}");
}

#[tokio::test]
async fn install_rejects_an_empty_skills_array_with_400() {
    let server = spawn_test_server(None).await;
    let id = registered_project(&server).await;

    let (status, body) = post_json(
        &server,
        &format!("/api/projects/{id}/skills-cli/install"),
        json!({ "source": "owner/repo", "skills": [], "scope": "project" }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["success"], json!(false));
    assert!(body["error"].is_string(), "{body:?}");
}

#[tokio::test]
async fn install_rejects_a_skill_name_beginning_with_a_dash_with_400() {
    let server = spawn_test_server(None).await;
    let id = registered_project(&server).await;

    let (status, body) = post_json(
        &server,
        &format!("/api/projects/{id}/skills-cli/install"),
        json!({ "source": "owner/repo", "skills": ["-x"], "scope": "project" }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["success"], json!(false));
    assert!(body["error"].is_string(), "{body:?}");
}

#[tokio::test]
async fn uninstall_rejects_an_unknown_scope_value_with_400() {
    let server = spawn_test_server(None).await;
    let id = registered_project(&server).await;

    let (status, body) = post_json(
        &server,
        &format!("/api/projects/{id}/skills-cli/uninstall"),
        json!({ "skills": ["a"], "scope": "unknown" }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["success"], json!(false));
    assert!(body["error"].is_string(), "{body:?}");
}

#[tokio::test]
async fn all_four_routes_answer_the_standard_envelope_shape() {
    let server = spawn_test_server(None).await;

    let (manifest_status, manifest_body) =
        get_json(&server, "/api/projects/missing/skills-cli/manifest").await;
    let (probe_status, probe_body) = post_json(
        &server,
        "/api/projects/missing/skills-cli/probe",
        json!({ "source": "owner/repo" }),
    )
    .await;
    let (install_status, install_body) = post_json(
        &server,
        "/api/projects/missing/skills-cli/install",
        json!({ "source": "owner/repo", "skills": ["a"], "scope": "project" }),
    )
    .await;
    let (uninstall_status, uninstall_body) = post_json(
        &server,
        "/api/projects/missing/skills-cli/uninstall",
        json!({ "skills": ["a"], "scope": "project" }),
    )
    .await;

    for (status, body) in [
        (manifest_status, &manifest_body),
        (probe_status, &probe_body),
        (install_status, &install_body),
        (uninstall_status, &uninstall_body),
    ] {
        assert_eq!(status, StatusCode::NOT_FOUND, "{body:?}");
        assert!(body["success"].is_boolean(), "{body:?}");
        assert_eq!(body["success"], json!(false), "{body:?}");
        assert!(body["error"].is_string(), "{body:?}");
    }
}
