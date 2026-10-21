use mainframe_types::git::{BranchUpdateStatus, BranchUpdateStatusKind, PullResult};

use crate::git_service::test_support::{clone_repo, git, init_repo, real_service};

#[tokio::test]
async fn update_all_fast_forwards_tracking_branches_in_a_real_clone() {
    let tmp = tempfile::tempdir().unwrap();
    let origin = tmp.path().join("origin");
    tokio::fs::create_dir(&origin).await.unwrap();
    init_repo(&origin).await;
    git(&origin, &["branch", "feat/nested"]).await;
    git(&origin, &["branch", "stable"]).await;
    let clone = clone_repo(&origin).await;
    git(
        &clone,
        &["branch", "--track", "feat/nested", "origin/feat/nested"],
    )
    .await;
    git(&clone, &["branch", "--track", "stable", "origin/stable"]).await;
    git(&clone, &["branch", "local-only"]).await;
    git(&origin, &["checkout", "-q", "feat/nested"]).await;
    git(&origin, &["commit", "--allow-empty", "-qm", "nested"]).await;

    let result = real_service(&clone).update_all().await.unwrap();

    assert!(result.fetched);
    assert!(matches!(result.pull, PullResult::UpToDate));
    let status = |branch: &str, status| BranchUpdateStatus {
        branch: branch.to_string(),
        status,
        error: None,
    };
    assert_eq!(
        result.branches,
        vec![
            status("feat/nested", BranchUpdateStatusKind::Updated),
            status("stable", BranchUpdateStatusKind::UpToDate),
        ]
    );
    assert_eq!(
        git(&clone, &["rev-parse", "feat/nested"]).await,
        git(&origin, &["rev-parse", "feat/nested"]).await
    );
}
