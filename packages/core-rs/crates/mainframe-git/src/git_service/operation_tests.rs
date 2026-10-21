use std::path::Path;

use mainframe_types::git::{ActiveOperation, MergeResult, RebaseResult};

use crate::git_exec::GitTimeout;
use crate::git_service::AbortResult;
use crate::git_service::test_support::{failed, git, init_repo, ran, real_service, service};

#[tokio::test]
async fn merge_reports_the_diffstat_of_a_clean_merge() {
    let (svc, calls) = service(|_i, _args| {
        Ok("Auto-merging a.rs\nMerge made by the 'ort' strategy.\n 3 files changed, 10 insertions(+), 2 deletions(-)\n".to_string())
    });
    let MergeResult::Success { summary } = svc.merge("feat/foo").await.unwrap() else {
        panic!("expected success");
    };
    assert_eq!(
        (summary.commits, summary.insertions, summary.deletions),
        (1, 10, 2)
    );
    assert!(ran(
        &calls,
        &["merge", "--end-of-options", "feat/foo"],
        GitTimeout::Unbounded
    ));
}

#[tokio::test]
async fn merge_conflict_lists_unmerged_paths() {
    let (svc, _calls) = service(|_i, args| match args[0].as_str() {
        "merge" => Err(failed("CONFLICT (content): Merge conflict in src/index.ts")),
        _ => Ok("src/index.ts\nsrc/app.ts\n".to_string()),
    });
    let MergeResult::Conflict { conflicts, .. } = svc.merge("feat/foo").await.unwrap() else {
        panic!("expected conflict");
    };
    assert_eq!(conflicts, vec!["src/index.ts", "src/app.ts"]);
}

#[tokio::test]
async fn merge_failure_without_conflicts_is_an_error() {
    let (svc, _calls) = service(|_i, args| match args[0].as_str() {
        "merge" => Err(failed("merge: feat/foo - not something we can merge")),
        _ => Ok(String::new()),
    });
    let err = svc.merge("feat/foo").await.unwrap_err();
    assert!(err.to_string().contains("not something we can merge"));
}

#[tokio::test]
async fn abort_returns_false_when_no_merge_or_rebase() {
    let tmp = tempfile::tempdir().unwrap();
    init_repo(tmp.path()).await;
    let result = real_service(tmp.path()).abort().await.unwrap();
    assert_eq!(result, AbortResult { aborted: false });
}

/// A repository on `main` whose `feature` branch edits the same line of
/// `README.md`, so merging or rebasing either onto the other conflicts.
async fn diverged_repo(dir: &Path) {
    init_repo(dir).await;
    git(dir, &["checkout", "-q", "-b", "feature"]).await;
    tokio::fs::write(dir.join("README.md"), "feature\n")
        .await
        .unwrap();
    git(dir, &["commit", "-qam", "feature"]).await;
    git(dir, &["checkout", "-q", "main"]).await;
    tokio::fs::write(dir.join("README.md"), "main\n")
        .await
        .unwrap();
    git(dir, &["commit", "-qam", "main"]).await;
}

#[tokio::test]
async fn merge_conflict_is_reported_and_abortable_in_a_real_repo() {
    let tmp = tempfile::tempdir().unwrap();
    diverged_repo(tmp.path()).await;
    let svc = real_service(tmp.path());

    let MergeResult::Conflict { conflicts, .. } = svc.merge("feature").await.unwrap() else {
        panic!("expected conflict");
    };
    assert_eq!(conflicts, vec!["README.md"]);
    assert_eq!(
        svc.branches().await.unwrap().active_operation,
        Some(ActiveOperation::Merge)
    );

    assert_eq!(svc.abort().await.unwrap(), AbortResult { aborted: true });
    assert_eq!(svc.branches().await.unwrap().active_operation, None);
    assert_eq!(
        tokio::fs::read_to_string(tmp.path().join("README.md"))
            .await
            .unwrap(),
        "main\n"
    );
}

#[tokio::test]
async fn rebase_conflict_is_reported_and_abortable_in_a_real_repo() {
    let tmp = tempfile::tempdir().unwrap();
    diverged_repo(tmp.path()).await;
    let svc = real_service(tmp.path());

    let RebaseResult::Conflict { conflicts, .. } = svc.rebase("feature").await.unwrap() else {
        panic!("expected conflict");
    };
    assert_eq!(conflicts, vec!["README.md"]);
    assert_eq!(
        svc.branches().await.unwrap().active_operation,
        Some(ActiveOperation::Rebase)
    );

    assert_eq!(svc.abort().await.unwrap(), AbortResult { aborted: true });
    assert_eq!(svc.branches().await.unwrap().active_operation, None);
}
