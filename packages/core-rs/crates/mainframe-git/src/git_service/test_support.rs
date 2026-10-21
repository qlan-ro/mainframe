//! Test doubles for `GitService`: a recording executor that answers from a
//! closure, and helpers that build real throwaway repositories.

use std::future::Future;
use std::path::Path;
use std::sync::{Arc, Mutex};

use tokio::process::Command;

use super::{GitExec, GitService};
use crate::git_exec::{GitExecError, GitTimeout};

pub(super) type Call = (Vec<String>, GitTimeout);
pub(super) type Calls = Arc<Mutex<Vec<Call>>>;
type Handler = Box<dyn Fn(usize, &[String]) -> Result<String, GitExecError> + Send + Sync>;

/// Records every argv and answers with `handler(call_index, args)`.
pub(super) struct MockGitExec {
    handler: Handler,
    calls: Calls,
}

impl GitExec for MockGitExec {
    fn exec(
        &self,
        args: &[String],
        _cwd: &str,
        timeout: GitTimeout,
    ) -> impl Future<Output = Result<String, GitExecError>> + Send {
        let idx = {
            let mut calls = self.calls.lock().unwrap();
            calls.push((args.to_vec(), timeout));
            calls.len() - 1
        };
        let result = (self.handler)(idx, args);
        async move { result }
    }
}

pub(super) fn service(
    handler: impl Fn(usize, &[String]) -> Result<String, GitExecError> + Send + Sync + 'static,
) -> (GitService<MockGitExec>, Calls) {
    let calls = Calls::default();
    let mock = MockGitExec {
        handler: Box::new(handler),
        calls: calls.clone(),
    };
    (GitService::with_exec("/fake/path".to_string(), mock), calls)
}

/// A git run that exited 1 with `stderr`.
pub(super) fn failed(stderr: &str) -> GitExecError {
    GitExecError::Failed {
        command: String::new(),
        code: Some(1),
        stderr: stderr.to_string(),
    }
}

pub(super) fn argv(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

/// Whether git ran exactly `args` with `timeout`.
pub(super) fn ran(calls: &Calls, args: &[&str], timeout: GitTimeout) -> bool {
    calls
        .lock()
        .unwrap()
        .iter()
        .any(|(a, t)| *a == argv(args) && *t == timeout)
}

/// Runs git in `dir` for test setup, panicking when it fails.
pub(super) async fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .await
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// A repository on `main` with one commit of `README.md`.
pub(super) async fn init_repo(dir: &Path) {
    git(dir, &["init", "-b", "main"]).await;
    configure_identity(dir).await;
    tokio::fs::write(dir.join("README.md"), "# Test\n")
        .await
        .unwrap();
    git(dir, &["add", "README.md"]).await;
    git(dir, &["commit", "-m", "init"]).await;
}

/// `<parent>/clone`, a clone of `origin` ready to commit in.
pub(super) async fn clone_repo(origin: &Path) -> std::path::PathBuf {
    let parent = origin.parent().unwrap();
    let clone = parent.join("clone");
    git(parent, &["clone", "-q", &origin.to_string_lossy(), "clone"]).await;
    configure_identity(&clone).await;
    clone
}

async fn configure_identity(dir: &Path) {
    git(dir, &["config", "user.email", "test@test.com"]).await;
    git(dir, &["config", "user.name", "Test"]).await;
    // Hermetic against a global `commit.gpgsign`, which shells out to gpg.
    git(dir, &["config", "commit.gpgsign", "false"]).await;
}

pub(super) fn real_service(dir: &Path) -> GitService {
    GitService::for_project(dir.to_string_lossy().into_owned())
}
