use std::sync::atomic::{AtomicUsize, Ordering};

use mainframe_types::git::{PullResult, PushResult};

use crate::git_exec::GitTimeout;
use crate::git_service::test_support::{
    clone_repo, failed, git, init_repo, ran, real_service, service,
};

#[tokio::test]
async fn push_uses_the_upstream_branch_name_in_the_refspec() {
    let (svc, calls) = service(|_i, args| {
        Ok(match args[0].as_str() {
            "for-each-ref" => {
                "session/x-2\0origin/session/x\0origin\0refs/heads/session/x\0\n".to_string()
            }
            _ => String::new(),
        })
    });
    let result = svc.push(Some("session/x-2"), None).await.unwrap();
    assert!(matches!(result, PushResult::Success { .. }));
    assert!(ran(
        &calls,
        &[
            "push",
            "--end-of-options",
            "origin",
            "session/x-2:session/x"
        ],
        GitTimeout::Unbounded
    ));
}

#[tokio::test]
async fn push_falls_back_to_local_name_without_upstream() {
    let (svc, calls) = service(|_i, args| {
        Ok(match args[0].as_str() {
            "branch" => "* new-branch\n".to_string(),
            _ => String::new(),
        })
    });
    let result = svc.push(None, None).await.unwrap();
    assert!(matches!(result, PushResult::Success { .. }));
    assert!(ran(
        &calls,
        &[
            "push",
            "--end-of-options",
            "origin",
            "new-branch:new-branch"
        ],
        GitTimeout::Unbounded
    ));
}

#[tokio::test]
async fn push_ignores_an_upstream_that_is_a_local_branch() {
    let (svc, calls) = service(|_i, args| {
        Ok(match args[0].as_str() {
            "for-each-ref" => "feat\0main\0.\0refs/heads/main\0\n".to_string(),
            _ => String::new(),
        })
    });
    svc.push(Some("feat"), None).await.unwrap();
    assert!(ran(
        &calls,
        &["push", "--end-of-options", "origin", "feat:feat"],
        GitTimeout::Unbounded
    ));
}

#[tokio::test]
async fn push_reports_a_rejected_push() {
    let (svc, _calls) = service(|_i, args| match args[0].as_str() {
        "push" => Err(failed(
            " ! [rejected]        main -> main (non-fast-forward)",
        )),
        "branch" => Ok("* main\n".to_string()),
        _ => Ok(String::new()),
    });
    let result = svc.push(None, None).await.unwrap();
    assert!(matches!(result, PushResult::Rejected { .. }));
}

#[tokio::test]
async fn pull_fast_forwards_a_non_current_branch_with_a_fetch_refspec() {
    let rev = AtomicUsize::new(0);
    let (svc, calls) = service(move |_i, args| {
        Ok(match args[0].as_str() {
            "branch" => "* main\n".to_string(),
            "rev-parse" if rev.fetch_add(1, Ordering::SeqCst) == 0 => "aaa\n".to_string(),
            "rev-parse" => "bbb\n".to_string(),
            _ => String::new(),
        })
    });
    let result = svc
        .pull(Some("origin"), Some("feat/foo"), Some("feat/foo"))
        .await
        .unwrap();
    assert!(ran(
        &calls,
        &["fetch", "--end-of-options", "origin", "feat/foo:feat/foo"],
        GitTimeout::Unbounded
    ));
    assert!(matches!(result, PullResult::Success { .. }));
}

#[tokio::test]
async fn pull_up_to_date_when_non_current_ref_unchanged() {
    let (svc, _calls) = service(|_i, args| {
        Ok(match args[0].as_str() {
            "branch" => "* main\n".to_string(),
            "rev-parse" => "aaa\n".to_string(),
            _ => String::new(),
        })
    });
    let result = svc
        .pull(Some("origin"), Some("feat/foo"), Some("feat/foo"))
        .await
        .unwrap();
    assert!(matches!(result, PullResult::UpToDate));
}

#[tokio::test]
async fn pull_reports_new_commits_in_a_real_clone() {
    let tmp = tempfile::tempdir().unwrap();
    let origin = tmp.path().join("origin");
    tokio::fs::create_dir(&origin).await.unwrap();
    init_repo(&origin).await;
    let clone = clone_repo(&origin).await;
    tokio::fs::write(origin.join("README.md"), "# Test\nmore\n")
        .await
        .unwrap();
    git(&origin, &["commit", "-qam", "upstream"]).await;
    let svc = real_service(&clone);

    let PullResult::Success { summary } = svc.pull(None, None, None).await.unwrap() else {
        panic!("expected new commits");
    };
    assert_eq!((summary.changes, summary.insertions), (1, 1));
    assert!(matches!(
        svc.pull(None, None, None).await.unwrap(),
        PullResult::UpToDate
    ));
}
