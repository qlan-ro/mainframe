#![allow(dead_code)]
use super::TestServer;
use reqwest::StatusCode;
use serde_json::Value;
use std::path::Path;

pub fn run_git(cwd: &Path, args: &[&str]) {
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

pub fn init_repo() -> tempfile::TempDir {
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

pub async fn get_json(server: &TestServer, path: &str) -> (StatusCode, Value) {
    let res = reqwest::get(server.http_url(path)).await.unwrap();
    let status = res.status();
    (status, res.json().await.unwrap())
}
