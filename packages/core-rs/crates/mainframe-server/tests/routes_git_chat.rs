//! Route tests for `git_chat.rs` — the worktree-missing (409) / chat-not-found
//! (404) guards and the cross-project guard from `git-chat.test.ts`, translated
//! onto a real DB + real git repos. Chats are created via the db chats repo and
//! their `worktree_path` set through `ChatUpdate` (the Phase-4 ChatManager is not
//! required — resolution goes through the shared git.rs helpers).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::path::Path;

use mainframe_db::ChatUpdate;
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

fn init_repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    run_git(dir.path(), &["init", "-b", "main"]);
    run_git(dir.path(), &["config", "user.email", "t@t.com"]);
    run_git(dir.path(), &["config", "user.name", "T"]);
    run_git(dir.path(), &["config", "commit.gpgsign", "false"]);
    std::fs::write(dir.path().join("README.md"), "hello\n").unwrap();
    run_git(dir.path(), &["add", "-A"]);
    run_git(dir.path(), &["commit", "-m", "init"]);
    dir
}

async fn create_chat(server: &TestServer, project_id: &str) -> String {
    let pid = project_id.to_string();
    server
        .ctx
        .db
        .call(move |db| db.chats.create(&pid, "claude", None, None, None))
        .await
        .unwrap()
        .id
}

async fn set_worktree(server: &TestServer, chat_id: &str, path: &str) {
    let cid = chat_id.to_string();
    let wt = path.to_string();
    server
        .ctx
        .db
        .call(move |db| {
            db.chats.update(
                &cid,
                &ChatUpdate {
                    worktree_path: Some(Some(wt)),
                    ..Default::default()
                },
            )
        })
        .await
        .unwrap();
}

async fn post(server: &TestServer, path: &str, body: Value) -> reqwest::Response {
    reqwest::Client::new()
        .post(server.http_url(path))
        .json(&body)
        .send()
        .await
        .unwrap()
}

// ── chatRoute worktree-missing guard ─────────────────────────────────────────

#[tokio::test]
async fn status_returns_409_when_worktree_missing() {
    let server = spawn_test_server(None).await;
    let repo = init_repo();
    let id = server.create_project(repo.path().to_str().unwrap()).await;
    let chat = create_chat(&server, &id).await;
    set_worktree(&server, &chat, "/tmp/gone-worktree-xyz-does-not-exist").await;

    let res = post(&server, "/api/git/status", json!({ "chatId": chat })).await;
    assert_eq!(res.status(), StatusCode::CONFLICT);
    assert_eq!(
        res.json::<Value>().await.unwrap(),
        json!({ "success": false, "error": "Worktree missing" })
    );
}

#[tokio::test]
async fn status_returns_404_when_chat_unknown() {
    let server = spawn_test_server(None).await;
    let res = post(
        &server,
        "/api/git/status",
        json!({ "chatId": "does-not-exist" }),
    )
    .await;
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        res.json::<Value>().await.unwrap(),
        json!({ "success": false, "error": "Chat not found" })
    );
}

#[tokio::test]
async fn stage_returns_409_when_worktree_missing() {
    let server = spawn_test_server(None).await;
    let repo = init_repo();
    let id = server.create_project(repo.path().to_str().unwrap()).await;
    let chat = create_chat(&server, &id).await;
    set_worktree(&server, &chat, "/tmp/gone-worktree-xyz-does-not-exist").await;

    let res = post(
        &server,
        "/api/git/stage",
        json!({ "chatId": chat, "files": ["foo.ts"] }),
    )
    .await;
    assert_eq!(res.status(), StatusCode::CONFLICT);
    assert_eq!(
        res.json::<Value>().await.unwrap(),
        json!({ "success": false, "error": "Worktree missing" })
    );
}

#[tokio::test]
async fn commit_returns_409_when_worktree_missing() {
    let server = spawn_test_server(None).await;
    let repo = init_repo();
    let id = server.create_project(repo.path().to_str().unwrap()).await;
    let chat = create_chat(&server, &id).await;
    set_worktree(&server, &chat, "/tmp/gone-worktree-xyz-does-not-exist").await;

    let res = post(
        &server,
        "/api/git/commit",
        json!({ "chatId": chat, "message": "fix: thing", "files": [] }),
    )
    .await;
    assert_eq!(res.status(), StatusCode::CONFLICT);
    assert_eq!(
        res.json::<Value>().await.unwrap(),
        json!({ "success": false, "error": "Worktree missing" })
    );
}

// ── status success (chat without worktree → project root) ─────────────────────

#[tokio::test]
async fn status_returns_buckets_for_a_chat_on_the_project_root() {
    let server = spawn_test_server(None).await;
    let repo = init_repo();
    std::fs::write(repo.path().join("untracked.txt"), "x\n").unwrap();
    let id = server.create_project(repo.path().to_str().unwrap()).await;
    let chat = create_chat(&server, &id).await;

    let res = post(&server, "/api/git/status", json!({ "chatId": chat })).await;
    assert_eq!(res.status(), StatusCode::OK);
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["success"], true);
    let untracked = body["data"]["untracked"].as_array().unwrap();
    assert!(untracked.iter().any(|f| f == "untracked.txt"));
}

// ── diff-since-main guards ───────────────────────────────────────────────────

#[tokio::test]
async fn diff_since_main_returns_404_for_cross_project_chat() {
    let server = spawn_test_server(None).await;
    let repo1 = init_repo();
    let repo2 = init_repo();
    let proj1 = server.create_project(repo1.path().to_str().unwrap()).await;
    let proj2 = server.create_project(repo2.path().to_str().unwrap()).await;
    let chat = create_chat(&server, &proj2).await; // belongs to proj2

    let res = post(
        &server,
        &format!("/api/projects/{proj1}/git/diff-since-main"),
        json!({ "chatId": chat }),
    )
    .await;
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        res.json::<Value>().await.unwrap(),
        json!({ "success": false, "error": "Project not found" })
    );
}

#[tokio::test]
async fn diff_since_main_returns_409_when_worktree_missing() {
    let server = spawn_test_server(None).await;
    let repo = init_repo();
    let id = server.create_project(repo.path().to_str().unwrap()).await;
    let chat = create_chat(&server, &id).await;
    set_worktree(&server, &chat, "/tmp/gone-worktree-xyz-does-not-exist").await;

    let res = post(
        &server,
        &format!("/api/projects/{id}/git/diff-since-main"),
        json!({ "chatId": chat }),
    )
    .await;
    assert_eq!(res.status(), StatusCode::CONFLICT);
    assert_eq!(
        res.json::<Value>().await.unwrap(),
        json!({ "success": false, "error": "Worktree missing" })
    );
}

#[tokio::test]
async fn diff_since_main_returns_404_when_project_not_found_without_chat() {
    let server = spawn_test_server(None).await;
    let res = post(
        &server,
        "/api/projects/missing/git/diff-since-main",
        json!({}),
    )
    .await;
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        res.json::<Value>().await.unwrap(),
        json!({ "success": false, "error": "Project not found" })
    );
}
