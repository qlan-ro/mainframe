use super::*;

fn git(repo: &tempfile::TempDir, args: &[&str]) {
    let status = std::process::Command::new("git")
        .args(args)
        .current_dir(repo.path())
        .status()
        .unwrap();
    assert!(status.success(), "git {args:?} failed");
}

fn canonical(path: std::path::PathBuf) -> String {
    std::fs::canonicalize(path)
        .unwrap()
        .to_string_lossy()
        .to_string()
}

#[tokio::test]
async fn reusing_a_branch_binds_to_the_worktree_that_has_it_checked_out() {
    let (repo, project) = git_project();
    let existing = repo.path().join(".worktrees/feat-x");
    git(
        &repo,
        &[
            "worktree",
            "add",
            "-b",
            "feat/x",
            existing.to_str().unwrap(),
        ],
    );
    let cell = Arc::new(Mutex::new(ActiveChat::new(test_chat("c1"), None)));
    let manager = Harness::new(Setup::with_project(cell.clone(), project));

    manager
        .enable_or_reuse_worktree("c1", "HEAD", "feat/x")
        .await
        .unwrap();

    let chat = cell.lock().unwrap().chat.clone();
    assert_eq!(chat.worktree_path, Some(canonical(existing)));
    assert_eq!(chat.branch_name.as_deref(), Some("feat/x"));
    assert_eq!(chat.base_branch, None);
}

#[tokio::test]
async fn reusing_a_branch_without_a_worktree_checks_it_out_into_a_new_one() {
    let (repo, project) = git_project();
    git(&repo, &["commit", "-q", "--allow-empty", "-m", "on main"]);
    git(&repo, &["branch", "feat/x", "HEAD~1"]);
    let cell = Arc::new(Mutex::new(ActiveChat::new(test_chat("c1"), None)));
    let manager = Harness::new(Setup::with_project(cell.clone(), project));

    manager
        .enable_or_reuse_worktree("c1", "HEAD", "feat/x")
        .await
        .unwrap();

    let worktree = repo.path().join(".worktrees/feat-x");
    let chat = cell.lock().unwrap().chat.clone();
    assert_eq!(
        chat.worktree_path,
        Some(worktree.to_string_lossy().to_string())
    );
    assert_eq!(chat.base_branch, None);
    let head = std::process::Command::new("git")
        .args(["log", "-1", "--format=%s"])
        .current_dir(&worktree)
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&head.stdout).trim(),
        "init",
        "the existing branch must be checked out as is, not recreated from the base"
    );
}

#[tokio::test]
async fn reusing_a_branch_that_does_not_exist_creates_it_from_the_base() {
    let (repo, project) = git_project();
    let cell = Arc::new(Mutex::new(ActiveChat::new(test_chat("c1"), None)));
    let manager = Harness::new(Setup::with_project(cell.clone(), project));

    manager
        .enable_or_reuse_worktree("c1", "HEAD", "feat/x")
        .await
        .unwrap();

    assert_created_worktree(&repo);
    assert_eq!(cell.lock().unwrap().chat.base_branch, None);
    assert_eq!(
        cell.lock().unwrap().chat.branch_name.as_deref(),
        Some("feat/x")
    );
}

#[tokio::test]
async fn stores_only_named_branch_start_points() {
    let (repo, project) = git_project();
    git(&repo, &["branch", "release"]);
    git(
        &repo,
        &["update-ref", "refs/remotes/origin/release", "HEAD"],
    );
    git(&repo, &["tag", "snapshot"]);
    git(&repo, &["tag", "release"]);
    git(&repo, &["branch", "local-base"]);
    git(
        &repo,
        &["update-ref", "refs/remotes/origin/team/topic", "HEAD"],
    );
    git(&repo, &["checkout", "--detach"]);
    assert!(!mainframe_services::workspace::is_branch_start_point(&project.path, "release").await);
    let commit = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(repo.path())
        .output()
        .unwrap();
    let sha = String::from_utf8(commit.stdout).unwrap();

    for (branch, start, expected) in [
        ("local", "local-base", Some("local-base")),
        (
            "qualified",
            "refs/heads/release",
            Some("refs/heads/release"),
        ),
        (
            "qualified-remote",
            "refs/remotes/origin/team/topic",
            Some("refs/remotes/origin/team/topic"),
        ),
        ("remote", "origin/release", Some("origin/release")),
        ("head", "HEAD", None),
        ("tag", "snapshot", None),
        ("commit", sha.trim(), None),
        ("expression", "local-base~0", None),
    ] {
        let cell = Arc::new(Mutex::new(ActiveChat::new(test_chat("c1"), None)));
        let manager = Harness::new(Setup::with_project(cell.clone(), project.clone()));
        manager.enable_worktree("c1", start, branch).await.unwrap();
        let binding = &cell.lock().unwrap().chat;
        assert_eq!(binding.branch_name.as_deref(), Some(branch));
        assert_eq!(
            binding.base_branch.as_deref(),
            expected,
            "start point: {start}"
        );
    }
}
