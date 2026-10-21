use mainframe_types::git::{BranchInfo, DeleteBranchResult};

use crate::git_exec::GitTimeout;
use crate::git_parse::RemoteUrl;
use crate::git_service::test_support::{
    clone_repo, failed, git, init_repo, ran, real_service, service,
};

#[tokio::test]
async fn branches_splits_local_and_remote_and_skips_head_pointers() {
    let (svc, _calls) = service(|_i, args| {
        Ok(match args[0].as_str() {
            "branch" => "* main\n  feat/foo\n  remotes/origin/HEAD -> origin/main\n  remotes/origin/main\n  remotes/origin/feat/bar\n".to_string(),
            "for-each-ref" => "main\0origin/main\0origin\0refs/heads/main\0behind 2\n".to_string(),
            _ => String::new(),
        })
    });
    let result = svc.branches().await.unwrap();
    assert_eq!(result.current, "main");
    assert_eq!(
        result.local,
        vec![
            BranchInfo {
                name: "main".to_string(),
                current: true,
                tracking: Some("origin/main".to_string()),
                ahead: Some(0),
                behind: Some(2),
                worktree: None,
            },
            BranchInfo {
                name: "feat/foo".to_string(),
                current: false,
                tracking: None,
                ahead: None,
                behind: None,
                worktree: None,
            },
        ]
    );
    assert_eq!(result.remote, vec!["origin/main", "origin/feat/bar"]);
    assert_eq!(result.worktrees, Vec::<String>::new());
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
        Ok(match args[0].as_str() {
            "branch" => "* main\n  session/abc123\n".to_string(),
            "worktree" => worktree_list.clone(),
            _ => String::new(),
        })
    });
    let result = svc.branches().await.unwrap();
    assert_eq!(result.worktrees, vec!["my-feature"]);
    let worktree_of = |name: &str| {
        result
            .local
            .iter()
            .find(|b| b.name == name)
            .and_then(|b| b.worktree.clone())
    };
    assert_eq!(worktree_of("session/abc123").as_deref(), Some("my-feature"));
    assert_eq!(worktree_of("main"), None);
}

#[tokio::test]
async fn branches_reports_real_upstream_divergence() {
    let tmp = tempfile::tempdir().unwrap();
    let origin = tmp.path().join("origin");
    tokio::fs::create_dir(&origin).await.unwrap();
    init_repo(&origin).await;
    let clone = clone_repo(&origin).await;
    git(&origin, &["commit", "--allow-empty", "-m", "upstream"]).await;
    git(&clone, &["fetch", "-q"]).await;
    git(&clone, &["commit", "--allow-empty", "-m", "local one"]).await;
    git(&clone, &["commit", "--allow-empty", "-m", "local two"]).await;
    git(&clone, &["branch", "untracked"]).await;

    let result = real_service(&clone).branches().await.unwrap();
    let main = result.local.iter().find(|b| b.name == "main").unwrap();
    assert_eq!(main.tracking.as_deref(), Some("origin/main"));
    assert_eq!((main.ahead, main.behind), (Some(2), Some(1)));
    let untracked = result.local.iter().find(|b| b.name == "untracked").unwrap();
    assert_eq!(untracked.tracking, None);
    assert_eq!(result.remote, vec!["origin/main"]);
}

#[tokio::test]
async fn current_branch_returns_name() {
    let (svc, _calls) = service(|_i, _args| Ok("* feat/test\n".to_string()));
    assert_eq!(svc.current_branch().await.unwrap(), "feat/test");
}

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
    assert!(ran(&calls, &["remote", "-v"], GitTimeout::Default));
}

/// Answers `git remote` with `origin` and every other command with `checkout`.
fn origin_remote(
    checkout: impl Fn(&[String]) -> Result<String, crate::git_exec::GitExecError>
    + Send
    + Sync
    + 'static,
) -> impl Fn(usize, &[String]) -> Result<String, crate::git_exec::GitExecError> + Send + Sync {
    move |_i, args| {
        if args[0] == "remote" {
            Ok("origin\n".to_string())
        } else {
            checkout(args)
        }
    }
}

#[tokio::test]
async fn checkout_local_branch() {
    let (svc, calls) = service(|_i, _args| Ok(String::new()));
    svc.checkout("main").await.unwrap();
    assert!(ran(
        &calls,
        &["checkout", "--end-of-options", "main"],
        GitTimeout::Default
    ));
}

#[tokio::test]
async fn checkout_creates_tracking_branch_for_remote_ref() {
    let (svc, calls) = service(origin_remote(|_args| Ok(String::new())));
    svc.checkout("origin/feat/bar").await.unwrap();
    assert!(ran(
        &calls,
        &[
            "checkout",
            "--track",
            "-b",
            "feat/bar",
            "--end-of-options",
            "origin/feat/bar"
        ],
        GitTimeout::Default
    ));
}

#[tokio::test]
async fn checkout_no_tracking_for_non_remote_slash_branch() {
    let (svc, calls) = service(origin_remote(|_args| Ok(String::new())));
    svc.checkout("feat/foo").await.unwrap();
    assert!(ran(
        &calls,
        &["checkout", "--end-of-options", "feat/foo"],
        GitTimeout::Default
    ));
}

#[tokio::test]
async fn checkout_falls_back_to_plain_checkout_when_local_exists() {
    let (svc, calls) = service(origin_remote(|args| {
        if args[1] == "--track" {
            Err(failed("fatal: a branch named 'feat/bar' already exists"))
        } else {
            Ok(String::new())
        }
    }));
    svc.checkout("origin/feat/bar").await.unwrap();
    assert!(ran(
        &calls,
        &["checkout", "--end-of-options", "feat/bar"],
        GitTimeout::Default
    ));
}

#[tokio::test]
async fn checkout_returns_other_errors_for_remote_ref() {
    let (svc, calls) = service(origin_remote(|_args| {
        Err(failed("fatal: invalid reference: origin/bad-ref"))
    }));
    let err = svc.checkout("origin/bad-ref").await.unwrap_err();
    assert!(err.to_string().contains("invalid reference"));
    let checkouts = calls
        .lock()
        .unwrap()
        .iter()
        .filter(|(a, _)| a[0] == "checkout")
        .count();
    assert_eq!(checkouts, 1);
}

#[tokio::test]
async fn checkout_treats_an_option_shaped_branch_as_a_ref() {
    let tmp = tempfile::tempdir().unwrap();
    init_repo(tmp.path()).await;
    let svc = real_service(tmp.path());

    let err = svc.checkout("--orphan=injected").await.unwrap_err();

    assert!(err.to_string().contains("did not match"), "{err}");
    assert_eq!(git(tmp.path(), &["branch", "--show-current"]).await, "main");
}

#[tokio::test]
async fn delete_branch_returns_success() {
    let (svc, calls) =
        service(|_i, _args| Ok("Deleted branch feat/old (was abc123).\n".to_string()));
    let result = svc.delete_branch("feat/old", false, false).await.unwrap();
    assert!(matches!(result, DeleteBranchResult::Success));
    assert!(ran(
        &calls,
        &["branch", "-d", "--end-of-options", "feat/old"],
        GitTimeout::Default
    ));
}

#[tokio::test]
async fn delete_branch_reports_unmerged_branches() {
    let (svc, _calls) =
        service(|_i, _args| Err(failed("error: the branch 'feat/old' is not fully merged")));
    let result = svc.delete_branch("feat/old", false, false).await.unwrap();
    assert!(matches!(result, DeleteBranchResult::NotMerged { .. }));
}

#[tokio::test]
async fn delete_remote_branch_pushes_a_delete_without_timeout() {
    let (svc, calls) = service(|_i, _args| Ok(String::new()));
    let result = svc
        .delete_branch("origin/feat/old", false, true)
        .await
        .unwrap();
    assert!(matches!(result, DeleteBranchResult::Success));
    assert!(ran(
        &calls,
        &["push", "--delete", "--end-of-options", "origin", "feat/old"],
        GitTimeout::Unbounded
    ));
}

#[tokio::test]
async fn delete_remote_branch_rejects_a_name_without_remote() {
    let (svc, calls) = service(|_i, _args| Ok(String::new()));
    let err = svc.delete_branch("feat", false, true).await.unwrap_err();
    assert_eq!(err.to_string(), "Invalid remote branch name: feat");
    assert!(calls.lock().unwrap().iter().all(|(a, _)| a[0] != "push"));
}
