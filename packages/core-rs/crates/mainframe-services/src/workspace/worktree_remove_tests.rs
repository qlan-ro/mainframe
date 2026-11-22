use super::checkout::repo_with_commit;
use super::*;

fn canonical(path: &Path) -> String {
    std::fs::canonicalize(path)
        .unwrap()
        .to_string_lossy()
        .into_owned()
}

async fn add_linked(repo: &str, path: &Path, branch: &str) {
    run_git(
        repo,
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            branch,
            path.to_str().unwrap(),
        ],
    )
    .await;
}

#[tokio::test]
async fn removes_a_linked_worktree_and_its_branch() {
    let dir = repo_with_commit().await;
    let repo = dir.path().to_str().unwrap();
    let linked = dir.path().join("wt");
    add_linked(repo, &linked, "feat/x").await;

    remove_worktree(repo, linked.to_str().unwrap(), "feat/x").await;

    assert!(!linked.exists());
    assert!(!branch_exists(repo, "feat/x").await);
}

#[tokio::test]
async fn deletes_a_linked_worktree_whose_git_metadata_was_pruned() {
    let dir = repo_with_commit().await;
    let repo = dir.path().to_str().unwrap();
    let linked = dir.path().join("wt");
    add_linked(repo, &linked, "feat/x").await;
    std::fs::remove_dir_all(dir.path().join(".git/worktrees/wt")).unwrap();

    remove_worktree(repo, linked.to_str().unwrap(), "feat/x").await;

    assert!(!linked.exists());
    assert!(!branch_exists(repo, "feat/x").await);
}

#[tokio::test]
async fn keeps_the_main_checkout_and_the_branch() {
    let dir = repo_with_commit().await;
    let repo = dir.path().to_str().unwrap();
    run_git(repo, &["branch", "keep"]).await;

    remove_worktree(repo, repo, "keep").await;

    assert!(dir.path().join(".git").is_dir());
    assert!(branch_exists(repo, "keep").await);
}

#[tokio::test]
async fn keeps_a_directory_that_is_not_a_worktree() {
    let dir = repo_with_commit().await;
    let repo = dir.path().to_str().unwrap();
    run_git(repo, &["branch", "keep"]).await;
    let other = tempfile::tempdir().unwrap();
    std::fs::write(other.path().join("notes.txt"), "mine").unwrap();

    remove_worktree(repo, other.path().to_str().unwrap(), "keep").await;

    assert!(other.path().join("notes.txt").exists());
    assert!(branch_exists(repo, "keep").await);
}

#[tokio::test]
async fn keeps_an_ancestor_of_the_project() {
    let parent = tempfile::tempdir().unwrap();
    std::fs::write(parent.path().join("notes.txt"), "mine").unwrap();
    let repo_dir = parent.path().join("repo");
    std::fs::create_dir(&repo_dir).unwrap();
    let repo = repo_dir.to_str().unwrap();
    run_git(repo, &["init", "-q", "-b", "main"]).await;
    run_git(repo, &["config", "user.email", "t@t.dev"]).await;
    run_git(repo, &["config", "user.name", "Tester"]).await;
    run_git(repo, &["commit", "-q", "--allow-empty", "-m", "init"]).await;

    remove_worktree(repo, parent.path().to_str().unwrap(), "main").await;

    assert!(parent.path().join("notes.txt").exists());
    assert!(repo_dir.join(".git").is_dir());
}

fn project(id: &str, path: &str) -> Project {
    Project {
        id: id.to_string(),
        name: id.to_string(),
        path: path.to_string(),
        created_at: String::new(),
        last_opened_at: String::new(),
        parent_project_id: Some(None),
        available: None,
    }
}

#[tokio::test]
async fn parent_links_point_a_linked_worktree_at_its_main_checkout_only() {
    let dir = repo_with_commit().await;
    let linked = dir.path().join("wt");
    add_linked(dir.path().to_str().unwrap(), &linked, "feat/x").await;
    let projects = [
        project("main", &canonical(dir.path())),
        project("linked", &canonical(&linked)),
    ];

    let links = compute_worktree_parent_links(&projects).await;

    assert_eq!(links, vec![("linked".to_string(), "main".to_string())]);
}

#[tokio::test]
async fn parent_links_skip_a_child_that_already_has_a_parent() {
    let dir = repo_with_commit().await;
    let linked = dir.path().join("wt");
    add_linked(dir.path().to_str().unwrap(), &linked, "feat/x").await;
    let mut child = project("linked", &canonical(&linked));
    child.parent_project_id = Some(Some("elsewhere".to_string()));
    let projects = [project("main", &canonical(dir.path())), child];

    assert!(compute_worktree_parent_links(&projects).await.is_empty());
}
