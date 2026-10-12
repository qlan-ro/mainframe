use super::*;
use tokio::process::Command;

async fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .await
        .unwrap();
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

async fn init_repo(dir: &Path) {
    git(dir, &["init"]).await;
    git(dir, &["config", "user.email", "test@test.com"]).await;
    git(dir, &["config", "user.name", "Test"]).await;
    // Hermetic against the developer's global git config: signing (if enabled
    // globally) shells out to gpg, which fails non-deterministically under the
    // parallel test load. Repo-local override applies to GitService's commits
    // too (they inherit repo config).
    git(dir, &["config", "commit.gpgsign", "false"]).await;
    tokio::fs::write(dir.join("README.md"), "# Test\n")
        .await
        .unwrap();
    git(dir, &["add", "README.md"]).await;
    git(dir, &["commit", "-m", "init"]).await;
}

// ---- commitAll ----

#[tokio::test]
async fn commit_all_stages_all_and_returns_sha() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    init_repo(dir).await;
    let svc = GitService::for_project(dir.to_string_lossy().into_owned());

    tokio::fs::write(dir.join("new-file.ts"), "export const x = 1;\n")
        .await
        .unwrap();
    tokio::fs::write(dir.join("README.md"), "# Updated\n")
        .await
        .unwrap();

    let sha = svc.commit_all("feat: add new file").await.unwrap();
    assert!(!sha.is_empty());
    assert_eq!(sha.len(), 40);
    assert!(sha.chars().all(|c| c.is_ascii_hexdigit()));
}

#[tokio::test]
async fn commit_all_includes_untracked_files() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    init_repo(dir).await;
    let svc = GitService::for_project(dir.to_string_lossy().into_owned());

    tokio::fs::write(dir.join("untracked.ts"), "const y = 2;\n")
        .await
        .unwrap();
    svc.commit_all("feat: commit untracked").await.unwrap();

    let log = git(dir, &["show", "--name-only", "--format=", "HEAD"]).await;
    assert!(log.contains("untracked.ts"));
}

#[tokio::test]
async fn commit_all_includes_deleted_files() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    init_repo(dir).await;
    let svc = GitService::for_project(dir.to_string_lossy().into_owned());

    tokio::fs::write(dir.join("to-delete.ts"), "const z = 3;\n")
        .await
        .unwrap();
    git(dir, &["add", "to-delete.ts"]).await;
    git(dir, &["commit", "-m", "add to-delete"]).await;

    tokio::fs::remove_file(dir.join("to-delete.ts"))
        .await
        .unwrap();
    svc.commit_all("chore: remove to-delete").await.unwrap();

    let log = git(dir, &["show", "--name-status", "--format=", "HEAD"]).await;
    assert!(log.contains('D') && log.contains("to-delete.ts"));
}

#[tokio::test]
async fn commit_all_throws_when_nothing_to_commit() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    init_repo(dir).await;
    let svc = GitService::for_project(dir.to_string_lossy().into_owned());
    assert!(svc.commit_all("empty commit").await.is_err());
}

// ---- workingStat ----

#[tokio::test]
async fn working_stat_empty_when_clean() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    init_repo(dir).await;
    let svc = GitService::for_project(dir.to_string_lossy().into_owned());
    let result = svc.working_stat().await.unwrap();
    assert_eq!(result.files, Vec::<WorkingStatFile>::new());
    assert_eq!(result.total_additions, 0);
    assert_eq!(result.total_deletions, 0);
}

#[tokio::test]
async fn working_stat_counts_modified_tracked() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    init_repo(dir).await;
    let svc = GitService::for_project(dir.to_string_lossy().into_owned());

    tokio::fs::write(dir.join("README.md"), "# Updated\nline2\nline3\n")
        .await
        .unwrap();
    let result = svc.working_stat().await.unwrap();
    let entry = result.files.iter().find(|f| f.path == "README.md").unwrap();
    assert!(entry.additions > 0);
    assert!(result.total_additions > 0);
}

#[tokio::test]
async fn working_stat_counts_new_untracked() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    init_repo(dir).await;
    let svc = GitService::for_project(dir.to_string_lossy().into_owned());

    tokio::fs::write(dir.join("new-file.ts"), "const a = 1;\nconst b = 2;\n")
        .await
        .unwrap();
    let result = svc.working_stat().await.unwrap();
    let entry = result
        .files
        .iter()
        .find(|f| f.path == "new-file.ts")
        .unwrap();
    assert_eq!(entry.additions, 2);
    assert_eq!(entry.deletions, 0);
    assert!(result.total_additions >= 2);
}

#[tokio::test]
async fn working_stat_counts_untracked_in_subdir() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    init_repo(dir).await;
    let svc = GitService::for_project(dir.to_string_lossy().into_owned());

    tokio::fs::create_dir_all(dir.join("src")).await.unwrap();
    tokio::fs::write(dir.join("src").join("index.ts"), "export {};\n")
        .await
        .unwrap();
    let result = svc.working_stat().await.unwrap();
    let entry = result
        .files
        .iter()
        .find(|f| f.path == "src/index.ts")
        .unwrap();
    assert_eq!(entry.additions, 1);
}

#[tokio::test]
async fn working_stat_counts_deletions() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    init_repo(dir).await;
    let svc = GitService::for_project(dir.to_string_lossy().into_owned());

    tokio::fs::write(dir.join("README.md"), "").await.unwrap();
    let result = svc.working_stat().await.unwrap();
    let entry = result.files.iter().find(|f| f.path == "README.md").unwrap();
    assert!(entry.deletions >= 1);
    assert!(result.total_deletions >= 1);
}

#[tokio::test]
async fn working_stat_binary_files_zero() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    init_repo(dir).await;
    let svc = GitService::for_project(dir.to_string_lossy().into_owned());

    tokio::fs::write(dir.join("data.bin"), [0x00u8, 0x01, 0x02, 0x03])
        .await
        .unwrap();
    let result = svc.working_stat().await.unwrap();
    let entry = result.files.iter().find(|f| f.path == "data.bin").unwrap();
    assert_eq!(entry.additions, 0);
    assert_eq!(entry.deletions, 0);
}

#[tokio::test]
async fn working_stat_totals_across_files() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    init_repo(dir).await;
    let svc = GitService::for_project(dir.to_string_lossy().into_owned());

    tokio::fs::write(dir.join("a.ts"), "const a = 1;\nconst b = 2;\n")
        .await
        .unwrap();
    tokio::fs::write(dir.join("b.ts"), "const c = 3;\n")
        .await
        .unwrap();
    let result = svc.working_stat().await.unwrap();
    let a_entry = result.files.iter().find(|f| f.path == "a.ts").unwrap();
    let b_entry = result.files.iter().find(|f| f.path == "b.ts").unwrap();
    assert_eq!(a_entry.additions, 2);
    assert_eq!(b_entry.additions, 1);
    assert!(result.total_additions >= 3);
    assert!(result.files.len() >= 2);
}
