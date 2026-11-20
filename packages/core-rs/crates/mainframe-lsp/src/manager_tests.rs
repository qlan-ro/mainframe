use super::*;
use crate::test_fixtures::{
    assert_pid_gone, echo_manager, manager_with, script_manager, timeouts, wait_for,
};
use std::sync::atomic::Ordering;

#[tokio::test]
async fn connect_rejects_a_missing_path_and_an_unsupported_language() {
    let manager = echo_manager();
    assert!(matches!(
        manager
            .connect("p1", "typescript", "/nonexistent-mainframe-lsp-scope")
            .await,
        Err(LspError::PathNotFound { .. })
    ));
    let root = tempfile::tempdir().unwrap();
    assert!(matches!(
        manager
            .connect("p1", "rust", root.path().to_str().unwrap())
            .await,
        Err(LspError::Unsupported(language)) if language == "rust"
    ));
    assert!(manager.active_languages("p1").is_empty());
}

#[tokio::test]
async fn connect_spawns_the_server_in_the_scope_path() {
    let worktree = tempfile::tempdir().unwrap();
    let path = worktree.path().to_str().unwrap();
    let manager = echo_manager();
    let handle = manager.connect("p1", "typescript", path).await.unwrap();
    assert_eq!(handle.project_path, path);
    manager.shutdown_all().await;
}

#[tokio::test]
async fn one_server_runs_per_project_and_language() {
    let (manager, resolver) = manager_with("cat", &[], timeouts());
    let (first, second) = tokio::join!(
        manager.get_or_spawn("p1", "typescript"),
        manager.get_or_spawn("p1", "typescript"),
    );
    let first = first.unwrap();
    assert!(Arc::ptr_eq(&first, &second.unwrap()));
    let again = manager.get_or_spawn("p1", "typescript").await.unwrap();
    assert!(Arc::ptr_eq(&first, &again));
    assert_eq!(resolver.calls.load(Ordering::SeqCst), 1);

    manager.get_or_spawn("p1", "python").await.unwrap();
    manager.get_or_spawn("p2", "typescript").await.unwrap();
    let mut active = manager.active_languages("p1");
    active.sort();
    assert_eq!(active, ["python", "typescript"]);
    assert_eq!(resolver.calls.load(Ordering::SeqCst), 3);

    manager.shutdown_all().await;
    assert!(manager.active_languages("p1").is_empty());
    assert!(manager.active_languages("p2").is_empty());
}

#[tokio::test]
async fn shutdown_stops_the_child_and_removes_it() {
    let manager = echo_manager();
    let handle = manager.get_or_spawn("p1", "typescript").await.unwrap();
    manager.shutdown("p1", "typescript").await;
    assert!(handle.exited());
    assert!(manager.get_handle("p1", "typescript").is_none());
    assert_pid_gone(handle.pid).await;
}

#[tokio::test]
async fn the_idle_reaper_stops_a_server_that_never_writes() {
    // The reaper used to abort its own task at the first await of the
    // shutdown, so a server that ignores stdin and never writes survived.
    let manager = script_manager(
        "exec sleep 100",
        Timeouts {
            idle: Duration::from_millis(50),
            ..timeouts()
        },
    );
    let handle = manager.get_or_spawn("p1", "typescript").await.unwrap();
    let pid = handle.pid;
    drop(handle);
    wait_for("the idle server to be reaped", || {
        manager.active_languages("p1").is_empty()
    })
    .await;
    assert_pid_gone(pid).await;
}

#[tokio::test]
async fn reusing_a_server_restarts_its_idle_reaper() {
    let manager = echo_manager();
    let handle = manager.get_or_spawn("p1", "typescript").await.unwrap();
    let client = manager.attach(&handle);
    assert!(!handle.has_idle_timer());
    drop(client);
    assert!(handle.has_idle_timer());
    manager.get_or_spawn("p1", "typescript").await.unwrap();
    assert!(handle.has_idle_timer());
    manager.shutdown_all().await;
}

#[tokio::test]
async fn a_stale_handle_never_evicts_its_replacement() {
    let manager = echo_manager();
    let old = manager.get_or_spawn("p1", "typescript").await.unwrap();
    manager.shutdown("p1", "typescript").await;
    let new = manager.get_or_spawn("p1", "typescript").await.unwrap();

    // A late exit watcher or shutdown of the old server.
    manager.state.remove_handle(&old, 1001, "LSP server exited");

    let current = manager.get_handle("p1", "typescript").unwrap();
    assert!(Arc::ptr_eq(&current, &new));
    manager.shutdown_all().await;
}
