use crate::git_service::DetectedBaseBranch;
use crate::git_service::test_support::{argv, failed, git, init_repo, real_service, service};

#[tokio::test]
async fn last_commit_before_picks_the_newest_commit_older_than_the_date() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    init_repo(dir).await;
    let first = git(dir, &["rev-parse", "HEAD"]).await;
    let svc = real_service(dir);

    assert_eq!(
        svc.last_commit_before("2099-01-01T00:00:00.000Z")
            .await
            .unwrap(),
        Some(first)
    );
    assert_eq!(
        svc.last_commit_before("2000-01-01T00:00:00Z")
            .await
            .unwrap(),
        None
    );
}

#[tokio::test]
async fn detect_base_branch_returns_main_when_merge_base_exists() {
    let (svc, calls) = service(|_idx, _args| Ok("abc123\n".to_string()));
    let result = svc.detect_base_branch().await.unwrap();
    assert_eq!(
        result,
        Some(DetectedBaseBranch {
            base_branch: "main".to_string(),
            merge_base: "abc123".to_string()
        })
    );
    let calls = calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(
        calls[0].0,
        argv(&["merge-base", "--end-of-options", "main", "HEAD"])
    );
}

#[tokio::test]
async fn detect_base_branch_falls_back_to_master() {
    let (svc, calls) = service(|idx, _args| {
        if idx == 0 {
            Err(failed("fatal: Not a valid object name main"))
        } else {
            Ok("def456\n".to_string())
        }
    });
    let result = svc.detect_base_branch().await.unwrap();
    assert_eq!(
        result,
        Some(DetectedBaseBranch {
            base_branch: "master".to_string(),
            merge_base: "def456".to_string()
        })
    );
    let calls = calls.lock().unwrap();
    assert_eq!(calls.len(), 2);
    assert_eq!(
        calls[1].0,
        argv(&["merge-base", "--end-of-options", "master", "HEAD"])
    );
}

#[tokio::test]
async fn detect_base_branch_returns_none_when_neither_resolves() {
    let (svc, _calls) = service(|_idx, _args| Err(failed("fatal: Not a valid object name")));
    assert_eq!(svc.detect_base_branch().await.unwrap(), None);
}
