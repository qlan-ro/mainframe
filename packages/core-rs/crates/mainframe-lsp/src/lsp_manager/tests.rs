//! Translated from `packages/core/src/__tests__/lsp/lsp-manager.test.ts`.
//!
//! The TS suite mocks `child_process.spawn` and `resolveCommand`. Here the
//! resolver is a fake pointing at a real `cat` child (reads stdin, echoes stdout,
//! stays alive until SIGTERM) — the parity of the mocked long-lived process. Idle
//! and shutdown timers are shrunk via `set_test_timeouts` so the suite runs in
//! real time (the TS twin used fake timers).

use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

struct FakeResolver {
    calls: Arc<AtomicUsize>,
}

impl CommandResolver for FakeResolver {
    fn resolve_command<'a>(
        &'a self,
        _language: &'a str,
    ) -> Pin<Box<dyn Future<Output = Option<ResolvedCommand>> + Send + 'a>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async {
            Some(ResolvedCommand {
                command: "cat".to_string(),
                args: vec![],
            })
        })
    }
}

fn manager() -> (LspManager, Arc<AtomicUsize>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let resolver = Arc::new(FakeResolver {
        calls: calls.clone(),
    });
    let mut m = LspManager::with_resolver(Arc::new(LspRegistry::new()), resolver);
    m.set_test_timeouts(
        Duration::from_millis(60),
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
