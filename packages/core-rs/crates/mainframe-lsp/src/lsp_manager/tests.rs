//! The resolver is a fake pointing at a real `cat` child (reads stdin, echoes
//! stdout, stays alive until SIGTERM) standing in for a long-lived server. Idle
//! and shutdown timers are shrunk via `set_test_timeouts` so the suite runs in
//! real time.

use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

struct FakeResolver {
    calls: Arc<AtomicUsize>,
    command: String,
    args: Vec<String>,
}

impl CommandResolver for FakeResolver {
    fn resolve_command<'a>(
        &'a self,
        _language: &'a str,
        _project_path: &'a str,
    ) -> Pin<Box<dyn Future<Output = Option<ResolvedCommand>> + Send + 'a>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let command = self.command.clone();
        let args = self.args.clone();
        Box::pin(async move { Some(ResolvedCommand { command, args }) })
    }
}

fn manager() -> (LspManager, Arc<AtomicUsize>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let resolver = Arc::new(FakeResolver {
        calls: calls.clone(),
        command: "cat".to_string(),
        args: vec![],
    });
    let mut m = LspManager::with_resolver(Arc::new(LspRegistry::new()), resolver);
    m.set_test_timeouts(
        Duration::from_millis(60),
        Duration::from_millis(150),
        Duration::from_millis(150),
        Duration::from_millis(150),
    );
    (m, calls)
}

#[tokio::test]
async fn spawns_a_new_server_for_unknown_key() {
    let (m, _) = manager();
    let handle = m.get_or_spawn("proj1", "typescript", "/tmp").await.unwrap();
    assert_eq!(handle.language, "typescript");
    assert_eq!(handle.project_path, "/tmp");
    m.shutdown_all().await;
}

#[tokio::test]
async fn returns_existing_handle_for_same_key() {
    let (m, _) = manager();
    let h1 = m.get_or_spawn("proj1", "typescript", "/tmp").await.unwrap();
    let h2 = m.get_or_spawn("proj1", "typescript", "/tmp").await.unwrap();
    assert!(Arc::ptr_eq(&h1, &h2));
    m.shutdown_all().await;
}

#[tokio::test]
async fn deduplicates_concurrent_spawn_calls() {
    let (m, calls) = manager();
    let (h1, h2) = tokio::join!(
        m.get_or_spawn("proj1", "typescript", "/tmp"),
        m.get_or_spawn("proj1", "typescript", "/tmp"),
    );
    let h1 = h1.unwrap();
    let h2 = h2.unwrap();
    assert!(Arc::ptr_eq(&h1, &h2));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    m.shutdown_all().await;
}

#[tokio::test]
async fn reports_active_languages_for_a_project() {
    let (m, _) = manager();
    m.get_or_spawn("proj1", "typescript", "/tmp").await.unwrap();
    let active = m.get_active_languages("proj1");
    assert!(active.contains(&"typescript".to_string()));
    assert!(!active.contains(&"python".to_string()));
    m.shutdown_all().await;
}

#[tokio::test]
async fn shutdown_removes_handle() {
    let (m, _) = manager();
    m.get_or_spawn("proj1", "typescript", "/tmp").await.unwrap();
    m.shutdown("proj1", "typescript").await;
    assert!(
        !m.get_active_languages("proj1")
            .contains(&"typescript".to_string())
    );
}

#[tokio::test]
async fn shutdown_all_clears_all_handles() {
    let (m, _) = manager();
    m.get_or_spawn("proj1", "typescript", "/tmp").await.unwrap();
    m.get_or_spawn("proj2", "typescript", "/tmp").await.unwrap();
    m.shutdown_all().await;
    assert!(m.get_active_languages("proj1").is_empty());
    assert!(m.get_active_languages("proj2").is_empty());
}

type SignalLog = Arc<Mutex<Vec<(u32, &'static str)>>>;

/// A manager whose servers run `script` under `/bin/sh` and ignore the LSP
/// shutdown handshake, with a signal seam that records each delivery before
/// really sending it.
fn signal_manager(script: &str, sigterm_grace: Duration) -> (LspManager, SignalLog) {
    let resolver = Arc::new(FakeResolver {
        calls: Arc::new(AtomicUsize::new(0)),
        command: "/bin/sh".to_string(),
        args: vec!["-c".to_string(), script.to_string()],
    });
    let mut manager = LspManager::with_resolver(Arc::new(LspRegistry::new()), resolver);
    manager.set_test_timeouts(
        Duration::from_secs(60),
        Duration::from_millis(25),
        Duration::from_millis(50),
        sigterm_grace,
    );
    let log: SignalLog = Arc::new(Mutex::new(Vec::new()));
    let sink = log.clone();
    let deliver = kill_signal();
    manager.set_test_signal(Arc::new(move |pid, flag| {
        sink.lock().unwrap().push((pid, flag));
        deliver(pid, flag)
    }));
    (manager, log)
}

/// A server script that ignores SIGTERM, creating `marker` once its trap is set.
fn ignores_sigterm(marker: &std::path::Path) -> String {
    format!("trap '' TERM; touch {}; exec sleep 100", marker.display())
}

/// Waits until every server spawned from [`ignores_sigterm`] has installed its
/// trap, so the SIGTERM that follows cannot kill it by default disposition.
async fn wait_for_markers(markers: &[std::path::PathBuf]) {
    tokio::time::timeout(Duration::from_secs(5), async {
        while !markers.iter().all(|m| m.exists()) {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the server should install its TERM trap");
}

#[tokio::test]
async fn shutdown_sends_only_sigterm_to_a_server_that_exits_on_it() {
    let (manager, signals) = signal_manager("exec sleep 100", Duration::from_secs(5));
    let handle = manager
        .get_or_spawn("proj1", "typescript", "/tmp")
        .await
        .unwrap();

    manager.shutdown("proj1", "typescript").await;

    assert_eq!(*signals.lock().unwrap(), vec![(handle.pid, "-TERM")]);
    assert!(handle.exited.load(Ordering::SeqCst));
    assert_pid_gone(handle.pid).await;
    assert!(manager.get_handle("proj1", "typescript").is_none());
}

#[tokio::test]
async fn shutdown_escalates_to_sigkill_and_waits_for_exit() {
    let dir = tempfile::tempdir().unwrap();
    let marker = dir.path().join("trapped");
    let (manager, signals) = signal_manager(&ignores_sigterm(&marker), Duration::from_millis(500));
    let handle = manager
        .get_or_spawn("proj1", "typescript", "/tmp")
        .await
        .unwrap();
    wait_for_markers(&[marker]).await;

    manager.shutdown("proj1", "typescript").await;

    assert_eq!(
        *signals.lock().unwrap(),
        vec![(handle.pid, "-TERM"), (handle.pid, "-KILL")]
    );
    assert!(handle.exited.load(Ordering::SeqCst));
    assert_pid_gone(handle.pid).await;
    assert!(manager.get_handle("proj1", "typescript").is_none());
}

#[tokio::test]
async fn shutdown_all_signals_every_server_before_escalating_any() {
    let dir = tempfile::tempdir().unwrap();
    // Each server touches a file named after its own shell pid.
    let script = format!(
        "trap '' TERM; touch {}/$$; exec sleep 100",
        dir.path().display()
    );
    let (manager, signals) = signal_manager(&script, Duration::from_millis(1_000));
    let first = manager
        .get_or_spawn("proj1", "typescript", "/tmp")
        .await
        .unwrap();
    let second = manager
        .get_or_spawn("proj1", "python", "/tmp")
        .await
        .unwrap();
    wait_for_markers(&[
        dir.path().join(first.pid.to_string()),
        dir.path().join(second.pid.to_string()),
    ])
    .await;

    manager.shutdown_all().await;

    // Shut down one after another, the first server's SIGKILL would come
    // before the second server's SIGTERM.
    let mut flags: Vec<(u32, &str)> = signals.lock().unwrap().clone();
    let (terms, kills) = flags.split_at_mut(2);
    terms.sort_unstable();
    kills.sort_unstable();
    let mut pids = [first.pid, second.pid];
    pids.sort_unstable();
    assert_eq!(terms, [(pids[0], "-TERM"), (pids[1], "-TERM")]);
    assert_eq!(kills, [(pids[0], "-KILL"), (pids[1], "-KILL")]);
    assert!(first.exited.load(Ordering::SeqCst));
    assert!(second.exited.load(Ordering::SeqCst));
    assert_pid_gone(first.pid).await;
    assert_pid_gone(second.pid).await;
}

#[tokio::test]
async fn starts_idle_timer_on_spawn_no_client_connected() {
    let (m, _) = manager();
    let handle = m.get_or_spawn("proj1", "typescript", "/tmp").await.unwrap();
    assert!(handle.has_idle_timer());
    m.shutdown_all().await;
}

#[tokio::test]
async fn returns_existing_handle_cancelling_and_restarting_idle_timer() {
    let (m, _) = manager();
    let handle = m.get_or_spawn("proj1", "typescript", "/tmp").await.unwrap();
    assert!(handle.has_idle_timer());
    let handle2 = m.get_or_spawn("proj1", "typescript", "/tmp").await.unwrap();
    assert!(Arc::ptr_eq(&handle, &handle2));
    m.shutdown_all().await;
}

#[tokio::test]
async fn idle_timer_fires_and_shuts_down_server_after_timeout() {
    let (m, _) = manager();
    m.get_or_spawn("proj1", "typescript", "/tmp").await.unwrap();
    assert!(
        m.get_active_languages("proj1")
            .contains(&"typescript".to_string())
    );

    // Idle timeout is 60ms; the graceful shutdown handshake adds request+exit
    // timeouts (150ms each) before the SIGTERM fallback.
    for _ in 0..40 {
        if !m
            .get_active_languages("proj1")
            .contains(&"typescript".to_string())
        {
            return;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("idle timer did not shut down the server");
}

async fn assert_pid_gone(pid: u32) {
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let status = Command::new("kill")
                .arg("-0")
                .arg(pid.to_string())
                .stderr(std::process::Stdio::null())
                .status()
                .await
                .unwrap();
            if !status.success() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the stopped child must no longer exist");
}
