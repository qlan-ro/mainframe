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

#[tokio::test]
async fn last_commit_before_picks_the_newest_commit_older_than_the_date() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    git(dir, &["init"]).await;
    git(dir, &["config", "user.email", "test@test.com"]).await;
    git(dir, &["config", "user.name", "Test"]).await;
    git(dir, &["config", "commit.gpgsign", "false"]).await;
    git(dir, &["commit", "--allow-empty", "-m", "init"]).await;
    let first = git(dir, &["rev-parse", "HEAD"]).await;
    let svc = GitService::for_project(dir.to_string_lossy().into_owned());

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
