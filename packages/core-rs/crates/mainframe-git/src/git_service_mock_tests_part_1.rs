use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

const PATH: &str = "/fake/path";

type Call = (Vec<String>, Option<GitExecOptions>);
type Handler = Box<dyn Fn(usize, &[String]) -> Result<String, GitExecError> + Send + Sync>;

struct MockGitExec {
    handler: Handler,
    calls: Arc<Mutex<Vec<Call>>>,
}

impl MockGitExec {
    fn new(
        handler: impl Fn(usize, &[String]) -> Result<String, GitExecError> + Send + Sync + 'static,
    ) -> Self {
        Self {
            handler: Box::new(handler),
            calls: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl GitExec for MockGitExec {
    fn exec(
        &self,
        args: Vec<String>,
        _cwd: String,
        opts: Option<GitExecOptions>,
    ) -> impl Future<Output = Result<String, GitExecError>> + Send {
        let idx = {
            let mut c = self.calls.lock().unwrap();
            c.push((args.clone(), opts.clone()));
            c.len() - 1
        };
        let result = (self.handler)(idx, &args);
        async move { result }
    }
}

fn gerr(message: &str) -> GitExecError {
    GitExecError {
        message: message.to_string(),
        code: None,
        stdout: None,
        stderr: None,
    }
}

fn service(
    handler: impl Fn(usize, &[String]) -> Result<String, GitExecError> + Send + Sync + 'static,
) -> (GitService<MockGitExec>, Arc<Mutex<Vec<Call>>>) {
    let mock = MockGitExec::new(handler);
    let calls = mock.calls.clone();
    (GitService::with_exec(PATH.to_string(), mock), calls)
}

fn owned(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

fn no_timeout() -> Option<GitExecOptions> {
    Some(GitExecOptions { timeout: Some(0) })
}

// ---- branches() ----

#[tokio::test]
async fn branches_returns_structured_branch_list() {
    let (svc, _calls) = service(|_i, args| {
        if args[0] == "branch" {
            Ok(
                "* main\n  feat/foo\n  remotes/origin/main\n  remotes/origin/feat/foo\n"
                    .to_string(),
            )
        } else if args[0] == "worktree" {
            Ok(String::new())
        } else {
            Ok("origin/main\n".to_string())
        }
    });
    let result = svc.branches().await.unwrap();
    assert_eq!(result.current, "main");
    assert_eq!(result.local.len(), 2);
    assert!(result.remote.contains(&"origin/main".to_string()));
    assert_eq!(result.worktrees, Vec::<String>::new());
}

#[tokio::test]
async fn branches_filters_out_remote_head_pseudo_refs() {
    let (svc, _calls) = service(|_i, args| {
        if args[0] == "branch" {
            Ok("* main\n  remotes/origin/HEAD -> origin/main\n  remotes/origin/main\n  remotes/origin/feat/bar\n".to_string())
        } else if args[0] == "worktree" {
            Ok(String::new())
        } else {
            Ok("origin/main\n".to_string())
        }
    });
    let result = svc.branches().await.unwrap();
    assert_eq!(
        result.remote,
        vec!["origin/main".to_string(), "origin/feat/bar".to_string()]
    );
    assert!(!result.remote.iter().any(|r| r.contains("HEAD")));
}

#[tokio::test]
async fn branches_tags_branches_with_worktree_dir_name() {
    let worktree_list = [
        "worktree /project",
        "HEAD aaa",
        "branch refs/heads/main",
        "",
        "worktree /project/.worktrees/my-feature",
        "HEAD bbb",
        "branch refs/heads/session/abc123",
        "",
    ]
    .join("\n");
    let (svc, _calls) = service(move |_i, args| {
        if args[0] == "branch" {
            Ok("* main\n  session/abc123\n".to_string())
        } else if args[0] == "worktree" {
            Ok(worktree_list.clone())
        } else {
            Ok("origin/main\n".to_string())
        }
    });
    let result = svc.branches().await.unwrap();
    assert_eq!(result.worktrees, vec!["my-feature".to_string()]);
    let wt_branch = result.local.iter().find(|b| b.name == "session/abc123");
    assert_eq!(
        wt_branch.and_then(|b| b.worktree.clone()),
        Some("my-feature".to_string())
    );
    let main_branch = result.local.iter().find(|b| b.name == "main");
    assert_eq!(main_branch.and_then(|b| b.worktree.clone()), None);
}

// ---- currentBranch() ----

#[tokio::test]
async fn current_branch_returns_name() {
    let (svc, _calls) = service(|_i, args| {
        Ok(if args[0] == "branch" {
            "* feat/test\n".to_string()
        } else {
            String::new()
        })
    });
    assert_eq!(svc.current_branch().await.unwrap(), "feat/test");
}

// ---- remotesWithUrls() ----

#[tokio::test]
async fn remotes_with_urls_issues_remote_dash_v_and_parses_the_output() {
    let (svc, calls) = service(|_i, _args| {
        Ok("origin\thttps://github.com/o/r.git (fetch)\n\
            origin\thttps://github.com/o/r.git (push)\n"
            .to_string())
    });
    let result = svc.remotes_with_urls().await.unwrap();
    assert_eq!(
        result,
        vec![RemoteUrl {
            name: "origin".to_string(),
            url: "https://github.com/o/r.git".to_string(),
        }]
    );
    let calls = calls.lock().unwrap();
    assert!(
        calls
            .iter()
            .any(|(a, o)| *a == owned(&["remote", "-v"]) && o.is_none())
    );
}

// ---- checkout() ----

#[tokio::test]
async fn checkout_local_branch() {
    let (svc, calls) = service(|_i, _args| Ok(String::new()));
    svc.checkout("main").await.unwrap();
    let calls = calls.lock().unwrap();
    assert!(
        calls
            .iter()
            .any(|(a, o)| *a == owned(&["checkout", "main"]) && o.is_none())
    );
}

#[tokio::test]
async fn checkout_creates_tracking_branch_for_remote_ref() {
    let (svc, calls) = service(|_i, args| {
        Ok(if args[0] == "remote" {
            "origin\n".to_string()
        } else {
            String::new()
        })
    });
    svc.checkout("origin/feat/bar").await.unwrap();
    let calls = calls.lock().unwrap();
    assert!(calls.iter().any(|(a, o)| *a
        == owned(&["checkout", "-b", "feat/bar", "origin/feat/bar", "--track"])
        && o.is_none()));
}

#[tokio::test]
async fn checkout_no_tracking_for_non_remote_slash_branch() {
    let (svc, calls) = service(|_i, args| {
        Ok(if args[0] == "remote" {
            "origin\n".to_string()
        } else {
            String::new()
        })
    });
    svc.checkout("feat/foo").await.unwrap();
    let calls = calls.lock().unwrap();
    assert!(
        calls
            .iter()
            .any(|(a, o)| *a == owned(&["checkout", "feat/foo"]) && o.is_none())
    );
}

#[tokio::test]
async fn checkout_falls_back_to_plain_checkout_when_local_exists() {
    let (svc, calls) = service(|_i, args| {
        if args[0] == "remote" {
            Ok("origin\n".to_string())
        } else if args.get(1).map(String::as_str) == Some("-b") {
            Err(gerr("A branch named 'feat/bar' already exists"))
        } else {
            Ok(String::new())
        }
    });
    svc.checkout("origin/feat/bar").await.unwrap();
    let calls = calls.lock().unwrap();
    assert!(calls.iter().any(|(a, o)| *a
        == owned(&["checkout", "-b", "feat/bar", "origin/feat/bar", "--track"])
        && o.is_none()));
    assert!(
        calls
            .iter()
            .any(|(a, o)| *a == owned(&["checkout", "feat/bar"]) && o.is_none())
    );
}

#[tokio::test]
async fn checkout_rethrows_non_exists_errors_for_remote_ref() {
    let (svc, calls) = service(|_i, args| {
        if args[0] == "remote" {
            Ok("origin\n".to_string())
        } else if args.get(1).map(String::as_str) == Some("-b") {
            Err(gerr("fatal: invalid reference: origin/bad-ref"))
        } else {
            Ok(String::new())
        }
    });
    let err = svc.checkout("origin/bad-ref").await.unwrap_err();
    assert!(err.to_string().contains("invalid reference"));
    let calls = calls.lock().unwrap();
    let checkout_calls = calls.iter().filter(|(a, _)| a[0] == "checkout").count();
    assert_eq!(checkout_calls, 1);
}

// ---- merge() ----

#[tokio::test]
async fn merge_success_on_clean_merge() {
    let (svc, _calls) = service(|_i, _args| {
        Ok("Merge made by the 'ort' strategy.\n 3 files changed, 10 insertions(+), 2 deletions(-)\n".to_string())
    });
    let result = svc.merge("feat/foo").await.unwrap();
    assert!(matches!(result, MergeResult::Success { .. }));
}
