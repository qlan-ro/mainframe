use super::*;

#[test]
fn short_branch_strips_the_leading_refs_heads() {
    assert_eq!(
        short_branch("refs/heads/feat/switch-offer"),
        "feat/switch-offer"
    );
}

#[test]
fn short_branch_leaves_an_embedded_refs_heads_intact() {
    assert_eq!(
        short_branch("refs/heads/feat/refs/heads/x"),
        "feat/refs/heads/x"
    );
}

#[test]
fn short_branch_returns_a_bare_name_unchanged() {
    assert_eq!(short_branch("main"), "main");
}

#[tokio::test]
async fn present_true_for_linked_worktree_git_file_pointer() {
    let dir = tempfile::tempdir().unwrap();
    let wt = dir.path().join("linked");
    tokio::fs::create_dir(&wt).await.unwrap();
    tokio::fs::write(wt.join(".git"), "gitdir: /repo/.git/worktrees/linked\n")
        .await
        .unwrap();
    assert!(is_worktree_present(wt.to_str().unwrap()));
}

#[tokio::test]
async fn present_true_for_main_checkout_git_directory() {
    let dir = tempfile::tempdir().unwrap();
    let repo = dir.path().join("repo");
    tokio::fs::create_dir_all(repo.join(".git")).await.unwrap();
    assert!(is_worktree_present(repo.to_str().unwrap()));
}

#[tokio::test]
async fn present_false_for_orphaned_stub_dir() {
    let dir = tempfile::tempdir().unwrap();
    let stub = dir.path().join("agent-stub");
    tokio::fs::create_dir(&stub).await.unwrap();
    assert!(!is_worktree_present(stub.to_str().unwrap()));
}

#[test]
fn present_false_for_path_that_does_not_exist() {
    assert!(!is_worktree_present("/definitely/does/not/exist/nope"));
}

#[test]
fn is_directory_present_sync_true_for_existing_dir() {
    let dir = tempfile::tempdir().unwrap();
    assert!(is_directory_present(dir.path().to_str().unwrap()));
}

#[test]
fn is_directory_present_sync_false_for_missing_path() {
    assert!(!is_directory_present("/definitely/does/not/exist/nope"));
}

#[test]
fn is_directory_present_sync_false_for_a_file_path() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("f.txt");
    std::fs::write(&file, "x").unwrap();
    assert!(!is_directory_present(file.to_str().unwrap()));
}

#[tokio::test]
async fn is_directory_present_async_true_for_existing_dir() {
    let dir = tempfile::tempdir().unwrap();
    assert!(is_directory_present_async(dir.path().to_str().unwrap()).await);
}

#[tokio::test]
async fn is_directory_present_async_false_for_missing_path() {
    assert!(!is_directory_present_async("/definitely/does/not/exist/nope").await);
}

#[tokio::test]
async fn is_directory_present_async_false_for_a_file_path() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("f.txt");
    tokio::fs::write(&file, "x").await.unwrap();
    assert!(!is_directory_present_async(file.to_str().unwrap()).await);
}

#[test]
fn parses_porcelain_output_into_worktree_entries() {
    let output = [
        "worktree /Users/dev/my-project",
        "HEAD abc1234",
        "branch refs/heads/main",
        "",
        "worktree /Users/dev/my-project/.worktrees/feat-x",
        "HEAD def5678",
        "branch refs/heads/feat-x",
        "",
    ]
    .join("\n");

    let entries = parse_worktree_list(&output);
    assert_eq!(
        entries,
        vec![
            WorktreeEntry {
                path: "/Users/dev/my-project".to_string(),
                branch: Some("refs/heads/main".to_string()),
            },
            WorktreeEntry {
                path: "/Users/dev/my-project/.worktrees/feat-x".to_string(),
                branch: Some("refs/heads/feat-x".to_string()),
            },
        ]
    );
}

#[test]
fn handles_detached_head_entries() {
    let output = [
        "worktree /Users/dev/repo",
        "HEAD abc1234",
        "branch refs/heads/main",
        "",
        "worktree /Users/dev/repo/.worktrees/detached",
        "HEAD def5678",
        "detached",
        "",
    ]
    .join("\n");

    let entries = parse_worktree_list(&output);
    assert_eq!(
        entries,
        vec![
            WorktreeEntry {
                path: "/Users/dev/repo".to_string(),
                branch: Some("refs/heads/main".to_string()),
            },
            WorktreeEntry {
                path: "/Users/dev/repo/.worktrees/detached".to_string(),
                branch: None,
            },
        ]
    );
}

#[test]
fn returns_empty_array_for_empty_input() {
    assert_eq!(parse_worktree_list(""), Vec::new());
}

async fn run_git(cwd: &str, args: &[&str]) {
    let status = tokio::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .await
        .expect("git available");
    assert!(status.status.success(), "git {args:?} failed");
}

#[tokio::test]
async fn branch_exists_true_for_existing_false_for_missing() {
    let dir = tempfile::tempdir().unwrap();
    let repo = dir.path().to_str().unwrap();
    run_git(repo, &["init", "-q"]).await;
    run_git(repo, &["config", "user.email", "t@t.dev"]).await;
    run_git(repo, &["config", "user.name", "Tester"]).await;
    tokio::fs::write(dir.path().join("f.txt"), "x")
        .await
        .unwrap();
    run_git(repo, &["add", "."]).await;
    run_git(repo, &["commit", "-q", "-m", "init"]).await;
    run_git(repo, &["branch", "feat-x"]).await;

    assert!(branch_exists(repo, "feat-x").await);
    assert!(!branch_exists(repo, "does-not-exist").await);
}
