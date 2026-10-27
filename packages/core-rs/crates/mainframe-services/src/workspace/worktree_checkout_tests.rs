use super::*;

async fn repo_with_commit() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let repo = dir.path().to_str().unwrap();
    run_git(repo, &["init", "-q", "-b", "main"]).await;
    run_git(repo, &["config", "user.email", "t@t.dev"]).await;
    run_git(repo, &["config", "user.name", "Tester"]).await;
    run_git(repo, &["config", "commit.gpgsign", "false"]).await;
    run_git(repo, &["commit", "-q", "--allow-empty", "-m", "init"]).await;
    dir
}

#[tokio::test]
async fn find_branch_worktree_returns_the_linked_worktree_on_that_branch() {
    let dir = repo_with_commit().await;
    let repo = dir.path().to_str().unwrap();
    let linked = dir.path().join("wt");
    run_git(
        repo,
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            "feat/x",
            linked.to_str().unwrap(),
        ],
    )
    .await;
    run_git(repo, &["branch", "idle"]).await;

    let expected = std::fs::canonicalize(&linked).unwrap();
    assert_eq!(
        find_branch_worktree(repo, "feat/x").await,
        Some(expected.to_string_lossy().to_string())
    );
    assert_eq!(find_branch_worktree(repo, "idle").await, None);
    assert_eq!(
        find_branch_worktree(repo, "main").await,
        None,
        "the main checkout is never a reusable worktree"
    );
}

#[tokio::test]
async fn find_branch_worktree_skips_a_worktree_whose_directory_is_gone() {
    let dir = repo_with_commit().await;
    let repo = dir.path().to_str().unwrap();
    let linked = dir.path().join("wt");
    run_git(
        repo,
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            "feat/x",
            linked.to_str().unwrap(),
        ],
    )
    .await;
    std::fs::remove_dir_all(&linked).unwrap();

    assert_eq!(find_branch_worktree(repo, "feat/x").await, None);
}

#[tokio::test]
async fn checkout_worktree_checks_an_existing_branch_out_at_the_standard_path() {
    let dir = repo_with_commit().await;
    let repo = dir.path().to_str().unwrap();
    run_git(repo, &["branch", "feat/x"]).await;

    let info = checkout_worktree(repo, ".worktrees", "feat/x")
        .await
        .unwrap();

    let expected = dir.path().join(".worktrees/feat-x");
    assert_eq!(
        info,
        WorktreeInfo {
            worktree_path: expected.to_string_lossy().to_string(),
            branch_name: "feat/x".to_string(),
        }
    );
    assert!(is_worktree_present(&info.worktree_path));
    assert_eq!(
        find_branch_worktree(repo, "feat/x").await,
        Some(
            std::fs::canonicalize(&expected)
                .unwrap()
                .to_string_lossy()
                .to_string()
        )
    );
}

#[tokio::test]
async fn checkout_worktree_recovers_a_branch_whose_old_worktree_was_deleted() {
    let dir = repo_with_commit().await;
    let repo = dir.path().to_str().unwrap();
    let old = dir.path().join("old");
    run_git(
        repo,
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            "feat/x",
            old.to_str().unwrap(),
        ],
    )
    .await;
    std::fs::remove_dir_all(&old).unwrap();

    let info = checkout_worktree(repo, ".worktrees", "feat/x")
        .await
        .unwrap();

    assert!(is_worktree_present(&info.worktree_path));
}
