use super::*;
use crate::test_fixtures::bounded;
use std::sync::atomic::AtomicUsize;
use std::sync::atomic::Ordering;
use tokio::sync::Semaphore;

struct BlockedResolver {
    calls: AtomicUsize,
    started: Semaphore,
    release: Semaphore,
    marker: std::path::PathBuf,
}

impl CommandResolver for BlockedResolver {
    fn resolve<'a>(&'a self, _language: &'a str, _project: &'a Path) -> ResolveFuture<'a> {
        Box::pin(async move {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.started.add_permits(1);
            self.release.acquire().await.unwrap().forget();
            Some(ResolvedCommand {
                command: "/bin/sh".into(),
                args: vec![
                    "-c".into(),
                    "touch \"$1\"; exec cat".into(),
                    "sh".into(),
                    self.marker.to_string_lossy().into_owned(),
                ],
            })
        })
    }
}

fn fixture(marker: std::path::PathBuf) -> (LspManager, Arc<BlockedResolver>) {
    let resolver = Arc::new(BlockedResolver {
        calls: AtomicUsize::new(0),
        started: Semaphore::new(0),
        release: Semaphore::new(0),
        marker,
    });
    let manager = LspManager::with_resolver(
        Arc::new(LspRegistry::new()),
        resolver.clone(),
        crate::test_fixtures::timeouts(),
    );
    (manager, resolver)
}

async fn assert_pending<F: Future>(mut future: Pin<&mut F>) {
    assert!(
        std::future::poll_fn(|cx| std::task::Poll::Ready(future.as_mut().poll(cx)))
            .await
            .is_pending()
    );
}

#[tokio::test]
async fn shutdown_cancels_blocked_resolver_and_single_flight_waiters() {
    let dir = tempfile::tempdir().unwrap();
    let marker = dir.path().join("spawned");
    let (manager, resolver) = fixture(marker.clone());
    let first = manager.get_or_spawn("project", "rust");
    let second = manager.get_or_spawn("project", "rust");
    let third = manager.get_or_spawn("project", "rust");
    tokio::pin!(first, second, third);
    assert_pending(first.as_mut()).await;
    assert_pending(second.as_mut()).await;
    assert_pending(third.as_mut()).await;
    assert_eq!(resolver.calls.load(Ordering::SeqCst), 1);
    bounded(manager.shutdown_all()).await;
    resolver.release.add_permits(1);
    assert!(matches!(bounded(first).await, Err(LspError::ShuttingDown)));
    assert!(matches!(bounded(second).await, Err(LspError::ShuttingDown)));
    assert!(matches!(bounded(third).await, Err(LspError::ShuttingDown)));
    assert!(matches!(
        manager.get_or_spawn("new", "python").await,
        Err(LspError::ShuttingDown)
    ));
    assert!(manager.state.flights.is_empty());
    assert!(manager.state.handles.is_empty());
    assert_eq!(resolver.calls.load(Ordering::SeqCst), 1);
    assert!(!marker.exists());
}

#[tokio::test]
async fn cancelling_spawn_owner_allows_waiter_to_resolve_and_spawn() {
    let dir = tempfile::tempdir().unwrap();
    let marker = dir.path().join("spawned");
    let (manager, resolver) = fixture(marker.clone());
    let mut first = Box::pin(manager.get_or_spawn("project", "rust"));
    let mut waiter = Box::pin(manager.get_or_spawn("project", "rust"));
    assert_pending(first.as_mut()).await;
    assert_pending(waiter.as_mut()).await;
    drop(first);
    resolver.release.add_permits(1);
    let handle = bounded(waiter).await.unwrap();
    mainframe_runtime::test_support::poll_until(
        std::time::Duration::from_secs(5),
        std::time::Duration::from_millis(5),
        async || marker.exists(),
    )
    .await
    .unwrap();
    assert_eq!(resolver.calls.load(Ordering::SeqCst), 2);
    assert!(manager.state.flights.is_empty());
    bounded(manager.shutdown_all()).await;
    assert!(handle.exited());
}

#[tokio::test]
async fn stalled_resolver_does_not_delay_shutdown_or_its_waiters() {
    let dir = tempfile::tempdir().unwrap();
    let (manager, resolver) = fixture(dir.path().join("spawned"));
    let manager = Arc::new(manager);
    let spawning = manager.clone();
    let task = tokio::spawn(async move { spawning.get_or_spawn("project", "rust").await });
    bounded(resolver.started.acquire()).await.unwrap().forget();
    bounded(manager.shutdown_all()).await;
    assert!(matches!(
        bounded(task).await.unwrap(),
        Err(LspError::ShuttingDown)
    ));
    assert!(manager.state.flights.is_empty());
    assert!(manager.state.handles.is_empty());
}

#[tokio::test]
async fn resolved_command_cannot_spawn_after_shutdown_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    let marker = dir.path().join("spawned");
    let (manager, resolver) = fixture(marker.clone());
    let pending = manager.state.spawn("project", "rust", "/tmp");
    tokio::pin!(pending);
    assert_pending(pending.as_mut()).await;
    bounded(manager.shutdown_all()).await;
    resolver.release.add_permits(1);
    assert!(matches!(
        bounded(pending).await,
        Err(LspError::ShuttingDown)
    ));
    assert!(manager.state.handles.is_empty());
    assert!(!marker.exists());
}
