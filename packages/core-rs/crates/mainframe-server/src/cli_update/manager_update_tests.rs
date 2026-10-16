use std::sync::atomic::Ordering;

use mainframe_types::cli_update::CliInstallMethod;
use tokio::sync::Notify;

use super::fake::{FakeEnv, setup, wait_for_finish};
use super::*;

#[tokio::test]
async fn a_successful_update_streams_output_reloads_the_adapter_and_reports_the_new_version() {
    let (manager, env) = setup(FakeEnv::new());
    manager.check("codex", false).await.unwrap();
    let started = manager.start_update("codex").unwrap();
    assert_eq!(
        started.update.as_ref().unwrap().state,
        CliUpdateState::Running
    );

    let done = wait_for_finish(&env).await;
    let run = done.update.as_ref().unwrap();
    assert_eq!(run.state, CliUpdateState::Succeeded);
    assert_eq!(run.version_after.as_deref(), Some("0.163.0"));
    assert_eq!(
        run.output,
        "==> Upgrading codex\n🍺  codex was successfully upgraded!\n"
    );
    assert!(run.error.is_none());
    assert_eq!(done.installed_version.as_deref(), Some("0.163.0"));
    assert!(!done.update_available);
    assert_eq!(env.reloads.load(Ordering::SeqCst), 1);
    // Output lines were pushed while the run was still going.
    assert!(env.emitted.lock_recover().iter().any(|s| {
        s.update.as_ref().is_some_and(|r| {
            r.state == CliUpdateState::Running && r.output == "==> Upgrading codex\n"
        })
    }));
}

#[tokio::test]
async fn a_second_update_while_one_runs_is_busy() {
    let gate = Arc::new(Notify::new());
    let mut env = FakeEnv::new();
    env.gate = Some(gate.clone());
    let (manager, env) = setup(env);
    manager.check("codex", false).await.unwrap();
    manager.start_update("codex").unwrap();
    assert_eq!(manager.start_update("codex"), Err(CliUpdateError::Busy));
    // A check during the run doesn't re-probe over it.
    let during = manager.check("codex", true).await.unwrap();
    assert_eq!(during.update.unwrap().state, CliUpdateState::Running);
    gate.notify_one();
    wait_for_finish(&env).await;
}

#[tokio::test]
async fn a_permission_failure_is_flagged_and_does_not_reload() {
    let mut env = FakeEnv::new();
    env.method = CliInstallMethod::Npm;
    env.lines = vec![
        "npm error code EACCES",
        "npm error path /usr/local/lib/node_modules",
    ];
    env.outcome = RunOutcome::Exited(Some(243));
    let (manager, env) = setup(env);
    manager.check("codex", false).await.unwrap();
    manager.start_update("codex").unwrap();
    let done = wait_for_finish(&env).await;
    let run = done.update.unwrap();
    assert_eq!(run.state, CliUpdateState::Failed);
    assert!(run.permission_denied);
    assert_eq!(
        run.error.as_deref(),
        Some("The update command exited with code 243")
    );
    assert_eq!(done.installed_version.as_deref(), Some("0.155.1"));
    assert_eq!(env.reloads.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn timeouts_and_spawn_failures_explain_themselves() {
    let mut env = FakeEnv::new();
    env.lines = vec![];
    env.outcome = RunOutcome::SpawnFailed("No such file or directory (os error 2)".into());
    let (manager, env) = setup(env);
    manager.check("codex", false).await.unwrap();
    manager.start_update("codex").unwrap();
    let run = wait_for_finish(&env).await.update.unwrap();
    assert_eq!(
        run.error.as_deref(),
        Some("The update command failed to start: No such file or directory (os error 2)")
    );
    assert!(!run.permission_denied);

    let mut env = FakeEnv::new();
    env.outcome = RunOutcome::TimedOut;
    let (manager, env) = setup(env);
    manager.check("codex", false).await.unwrap();
    manager.start_update("codex").unwrap();
    let run = wait_for_finish(&env).await.update.unwrap();
    assert_eq!(run.error.as_deref(), Some("The update command timed out"));
}

#[tokio::test]
async fn an_unrecognised_install_cannot_be_updated_in_app() {
    let mut env = FakeEnv::new();
    env.method = CliInstallMethod::Unknown;
    env.can_update = false;
    let (manager, _env) = setup(env);
    let status = manager.check("codex", false).await.unwrap();
    assert!(!status.can_update);
    assert_eq!(
        manager.start_update("codex"),
        Err(CliUpdateError::NotUpdatable)
    );
}

#[tokio::test]
async fn updating_before_any_check_is_not_installed() {
    let (manager, _env) = setup(FakeEnv::new());
    assert_eq!(
        manager.start_update("codex"),
        Err(CliUpdateError::NotInstalled)
    );
    assert_eq!(
        manager.start_update("gemini"),
        Err(CliUpdateError::Unsupported)
    );
}
