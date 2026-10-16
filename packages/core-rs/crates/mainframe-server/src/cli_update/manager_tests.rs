use std::sync::atomic::Ordering;

use mainframe_types::cli_update::CliInstallMethod;

use super::fake::{FakeEnv, setup};
use super::*;

#[tokio::test]
async fn check_reports_installed_latest_and_update_available() {
    let (manager, env) = setup(FakeEnv::new());
    let status = manager.check("codex", false).await.unwrap();
    assert_eq!(status.adapter_id, "codex");
    assert_eq!(status.installed_version.as_deref(), Some("0.155.1"));
    assert_eq!(status.latest_version.as_deref(), Some("0.163.0"));
    assert!(status.update_available);
    assert_eq!(status.install_method, CliInstallMethod::Homebrew);
    assert_eq!(status.update_command, "brew upgrade --cask codex");
    assert!(status.can_update);
    assert!(!status.check_failed);
    assert_eq!(status.checked_at, Some(1_000));
    assert_eq!(env.last_emitted(), status);
    assert_eq!(manager.statuses(), vec![status]);
}

#[tokio::test]
async fn an_equal_or_older_latest_is_not_an_update() {
    let env = FakeEnv::new();
    *env.latest.lock_recover() = Some("0.155.1".into());
    let (manager, _env) = setup(env);
    assert!(
        !manager
            .check("codex", false)
            .await
            .unwrap()
            .update_available
    );
}

#[tokio::test]
async fn unsupported_adapters_are_rejected_and_skipped() {
    let (manager, _env) = setup(FakeEnv::new());
    assert_eq!(
        manager.check("mock-cli", true).await,
        Err(CliUpdateError::Unsupported)
    );
    manager.check_all(true).await;
    let ids: Vec<_> = manager
        .statuses()
        .into_iter()
        .map(|s| s.adapter_id)
        .collect();
    assert_eq!(ids, ["codex"]);
}

#[tokio::test]
async fn a_recent_check_is_reused_unless_forced() {
    let (manager, env) = setup(FakeEnv::new());
    manager.check("codex", false).await.unwrap();
    env.now
        .store(1_000 + RECHECK_AFTER_MS - 1, Ordering::SeqCst);
    manager.check("codex", false).await.unwrap();
    assert_eq!(env.latest_fetches.load(Ordering::SeqCst), 1);
    manager.check("codex", true).await.unwrap();
    assert_eq!(env.latest_fetches.load(Ordering::SeqCst), 2);
    env.now
        .store(1_000 + 2 * RECHECK_AFTER_MS, Ordering::SeqCst);
    manager.check("codex", false).await.unwrap();
    assert_eq!(env.latest_fetches.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn an_offline_check_keeps_the_last_known_latest_quietly() {
    let (manager, env) = setup(FakeEnv::new());
    manager.check("codex", false).await.unwrap();
    *env.latest.lock_recover() = None;
    let status = manager.check("codex", true).await.unwrap();
    assert!(status.check_failed);
    assert_eq!(status.latest_version.as_deref(), Some("0.163.0"));
    assert!(status.update_available);
}
