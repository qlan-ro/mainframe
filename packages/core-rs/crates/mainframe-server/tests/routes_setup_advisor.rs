//! Integration tests for the not-yet-mounted
//! `GET /api/projects/{id}/automation-recommendations` route (spec AC 7).
//!
//! T18 is expected RED: the handler is T19's job. Do not stub it to pass this
//! file — a route this file can't reach proves nothing about T19's behavior.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::fs;
use std::path::Path;

use reqwest::StatusCode;
use serde_json::{Value, json};
use support::{TestServer, spawn_test_server};

fn run_git(cwd: &Path, args: &[&str]) {
    let out = std::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// The rich fixture from T9's fingerprint test: a Next.js + React + Supabase
/// project with prettier/tsconfig/docker tooling, a tests dir, env + lock
/// files, and a GitHub origin.
fn rich_fixture_repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::write(
        root.join("package.json"),
        r#"{
            "dependencies": {
                "next": "14.0.0",
                "react": "18.2.0",
                "@supabase/supabase-js": "2.0.0"
            }
        }"#,
    )
    .unwrap();
    fs::write(root.join(".prettierrc"), "{}").unwrap();
    fs::write(root.join("tsconfig.json"), "{}").unwrap();
    fs::write(root.join("docker-compose.yml"), "services: {}").unwrap();
    fs::write(root.join(".env.example"), "API_KEY=").unwrap();
    fs::write(root.join("pnpm-lock.yaml"), "lockfileVersion: '6.0'").unwrap();
    fs::create_dir_all(root.join("tests")).unwrap();
    fs::write(root.join("tests/placeholder.txt"), "").unwrap();

    run_git(root, &["init", "-b", "main"]);
    run_git(root, &["config", "user.email", "t@t.com"]);
    run_git(root, &["config", "user.name", "T"]);
    run_git(root, &["config", "commit.gpgsign", "false"]);
    run_git(
        root,
        &["remote", "add", "origin", "git@github.com:acme/app.git"],
    );
    run_git(root, &["add", "-A"]);
    run_git(root, &["commit", "-m", "init"]);
    dir
}

async fn get_json(server: &TestServer, path: &str) -> (StatusCode, Value) {
    let res = reqwest::get(server.http_url(path)).await.unwrap();
    let status = res.status();
    (status, res.json().await.unwrap())
}

#[tokio::test]
async fn returns_a_report_with_camel_case_fields_for_a_registered_fixture_project() {
    let dir = rich_fixture_repo();
    let server = spawn_test_server(None).await;
    let id = server.create_project(&dir.path().to_string_lossy()).await;

    let (status, body) = get_json(
        &server,
        &format!("/api/projects/{id}/automation-recommendations"),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["success"], json!(true));

    let data = &body["data"];
    assert_eq!(data["fingerprint"]["gitHost"], json!("github"));

    let recommendations = data["recommendations"]
        .as_array()
        .expect("data.recommendations must be an array");
    assert!(
        recommendations
            .iter()
            .any(|r| r["id"] == json!("mcp-supabase")),
        "expected `mcp-supabase` among the recommendations; got {recommendations:?}"
    );

    let mcp_supabase = recommendations
        .iter()
        .find(|r| r["id"] == json!("mcp-supabase"))
        .unwrap();
    assert!(mcp_supabase.get("targetPath").is_none() || mcp_supabase["targetPath"].is_string());
    assert!(mcp_supabase["adapters"].is_array());
    assert!(mcp_supabase["provenance"].is_string());
}

#[tokio::test]
async fn returns_404_project_not_found_for_an_unknown_id() {
    let server = spawn_test_server(None).await;

    let (status, body) =
        get_json(&server, "/api/projects/missing/automation-recommendations").await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        body,
        json!({ "success": false, "error": "Project not found" })
    );
}

#[tokio::test]
async fn returns_404_project_path_not_found_when_the_registered_path_was_deleted() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_string_lossy().to_string();

    let server = spawn_test_server(None).await;
    let id = server.create_project(&path).await;
    drop(dir);

    let (status, body) = get_json(
        &server,
        &format!("/api/projects/{id}/automation-recommendations"),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        body,
        json!({ "success": false, "error": "Project path not found" })
    );
}

#[tokio::test]
async fn returns_404_project_path_not_found_when_the_registered_path_is_a_file() {
    let dir = tempfile::tempdir().unwrap();
    let file_path = dir.path().join("not-a-directory.txt");
    fs::write(&file_path, "hello\n").unwrap();

    let server = spawn_test_server(None).await;
    let id = server.create_project(&file_path.to_string_lossy()).await;

    let (status, body) = get_json(
        &server,
        &format!("/api/projects/{id}/automation-recommendations"),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        body,
        json!({ "success": false, "error": "Project path not found" })
    );
}
