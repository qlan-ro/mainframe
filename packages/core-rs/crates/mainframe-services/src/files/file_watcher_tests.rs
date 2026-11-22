use super::*;
use tokio::sync::mpsc;

fn touch(path: &Path) {
    std::fs::write(path, b"x").unwrap();
}

#[tokio::test]
async fn starts_a_watcher_when_first_client_subscribes() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("test.ts");
    touch(&file);
    let svc = FileWatcherService::new(|_| {});
    svc.subscribe(file.to_str().unwrap(), file.to_str().unwrap());
    assert!(svc.is_watching(file.to_str().unwrap()));
}

#[tokio::test]
async fn does_not_start_a_second_watcher_for_the_same_path() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("test.ts");
    touch(&file);
    let svc = FileWatcherService::new(|_| {});
    let p = file.to_str().unwrap();
    svc.subscribe(p, p);
    svc.subscribe(p, p);
    assert!(svc.is_watching(p));
    // Still watching after one unsubscribe (ref_count was 2).
    svc.unsubscribe(p);
    assert!(svc.is_watching(p));
}

#[tokio::test]
async fn closes_watcher_when_last_subscriber_unsubscribes() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("test.ts");
    touch(&file);
    let svc = FileWatcherService::new(|_| {});
    let p = file.to_str().unwrap();
    svc.subscribe(p, p);
    svc.unsubscribe(p);
    assert!(!svc.is_watching(p));
}

#[tokio::test]
async fn keeps_watcher_when_there_are_remaining_subscribers() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("test.ts");
    touch(&file);
    let svc = FileWatcherService::new(|_| {});
    let p = file.to_str().unwrap();
    svc.subscribe(p, p);
    svc.subscribe(p, p);
    svc.unsubscribe(p);
    assert!(svc.is_watching(p));
    svc.unsubscribe(p);
    assert!(!svc.is_watching(p));
}

#[tokio::test]
async fn unsubscribe_for_unknown_path_is_a_no_op() {
    let svc = FileWatcherService::new(|_| {});
    svc.unsubscribe("/tmp/unknown.ts"); // must not panic
}

async fn wait_for_event(rx: &mut mpsc::UnboundedReceiver<DaemonEvent>) -> Option<DaemonEvent> {
    tokio::time::timeout(Duration::from_secs(10), rx.recv())
        .await
        .ok()
        .flatten()
}

/// A parent-directory watch keeps emitting `file:changed` after an atomic
/// rename-over. Two replacements prove it stays armed after the first event.
#[tokio::test]
async fn keeps_firing_after_atomic_rename_over() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("watched.txt");
    std::fs::write(&file, b"initial").unwrap();

    let (tx, mut rx) = mpsc::unbounded_channel::<DaemonEvent>();
    let svc = FileWatcherService::new(move |ev| {
        let _ = tx.send(ev);
    });
    let path = file.to_str().unwrap().to_string();
    svc.subscribe(&path, &path);

    let atomic_replace = |body: &[u8], tmp_name: &str| {
        let tmp = dir.path().join(tmp_name);
        std::fs::write(&tmp, body).unwrap();
        std::fs::rename(&tmp, &file).unwrap();
    };

    atomic_replace(b"replaced", "watched.txt.tmp1");
    match wait_for_event(&mut rx).await {
        Some(DaemonEvent::FileChanged { path: p }) => assert_eq!(p, path),
        other => panic!("expected file:changed after first atomic rename, got {other:?}"),
    }

    // Drain, then a SECOND atomic replace to prove the watch did not go silent
    // (the watcher must stay armed across atomic replacement).
    while rx.try_recv().is_ok() {}
    atomic_replace(b"again", "watched.txt.tmp2");
    match wait_for_event(&mut rx).await {
        Some(DaemonEvent::FileChanged { path: p }) => assert_eq!(p, path),
        other => panic!("expected file:changed after second atomic rename, got {other:?}"),
    }
}

/// An atomic rename must not disturb ref-counting, so tear-down still
/// waits for the last subscriber. The parent-dir watch is never re-created, so
/// the entry (and its `ref_count`) survives the rename untouched.
#[tokio::test]
async fn refcount_survives_atomic_rename() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("watched.txt");
    std::fs::write(&file, b"initial").unwrap();
    let (tx, mut rx) = mpsc::unbounded_channel();
    let svc = FileWatcherService::new(move |event| {
        let _ = tx.send(event);
    });
    let p = file.to_str().unwrap();
    svc.subscribe(p, p);
    svc.subscribe(p, p); // ref_count 2

    let tmp = dir.path().join("watched.txt.tmp");
    std::fs::write(&tmp, b"replaced").unwrap();
    std::fs::rename(&tmp, &file).unwrap();

    assert!(wait_for_event(&mut rx).await.is_some());
    svc.unsubscribe(p);
    assert!(
        svc.is_watching(p),
        "still watching while a subscriber remains"
    );
    svc.unsubscribe(p);
    assert!(
        !svc.is_watching(p),
        "torn down after the last subscriber leaves"
    );
}

/// macOS behavior test: create + modify a real file in a tempdir and assert a
/// debounced `file:changed` event is emitted for it (verifies the notify event
/// mapping follows the platform file-watcher behavior).
#[tokio::test]
async fn broadcasts_file_changed_on_real_modify() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("watched.txt");
    std::fs::write(&file, b"initial").unwrap();

    let (tx, mut rx) = mpsc::unbounded_channel::<DaemonEvent>();
    let svc = FileWatcherService::new(move |ev| {
        let _ = tx.send(ev);
    });
    let path = file.to_str().unwrap().to_string();
    svc.subscribe(&path, &path);

    std::fs::write(&file, b"changed").unwrap();

    let got = wait_for_event(&mut rx).await;

    match got {
        Some(DaemonEvent::FileChanged { path: p }) => assert_eq!(p, path),
        other => panic!("expected a file:changed event for the modified file, got {other:?}"),
    }
}

/// Subscribers racing on one path must each hold a reference: the watcher
/// survives until every one of them has left.
#[test]
fn concurrent_subscribes_to_one_path_each_hold_a_reference() {
    const SUBSCRIBERS: usize = 8;
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("shared.txt");
    touch(&file);
    let path = file.to_str().unwrap();
    let svc = FileWatcherService::new(|_| {});
    let barrier = std::sync::Barrier::new(SUBSCRIBERS);

    std::thread::scope(|scope| {
        for _ in 0..SUBSCRIBERS {
            scope.spawn(|| {
                barrier.wait();
                svc.subscribe(path, path);
            });
        }
    });

    for _ in 1..SUBSCRIBERS {
        svc.unsubscribe(path);
    }
    assert!(svc.is_watching(path), "one subscriber is still attached");
    svc.unsubscribe(path);
    assert!(!svc.is_watching(path));
}

/// Tearing a watch down while its file keeps changing must not hang: the
/// watcher is dropped with the map lock released. Detached named threads let
/// a regression fail on the deadline instead of hanging the test run.
#[test]
fn unsubscribing_while_the_file_changes_does_not_hang() {
    use std::sync::atomic::{AtomicBool, Ordering};
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("busy.txt");
    touch(&file);
    let path = file.to_str().unwrap().to_string();
    let svc = Arc::new(FileWatcherService::new(|_| {}));
    let stop = Arc::new(AtomicBool::new(false));

    let writer = {
        let stop = Arc::clone(&stop);
        std::thread::Builder::new()
            .name("watch-test-writer".into())
            .spawn(move || {
                let mut n = 0u64;
                while !stop.load(Ordering::Relaxed) {
                    n += 1;
                    std::fs::write(&file, n.to_string()).unwrap();
                }
            })
            .unwrap()
    };
    let (done_tx, done_rx) = std::sync::mpsc::channel();
    std::thread::Builder::new()
        .name("watch-test-churn".into())
        .spawn(move || {
            for _ in 0..200 {
                svc.subscribe(&path, &path);
                std::thread::sleep(Duration::from_millis(2));
                svc.unsubscribe(&path);
            }
            let _ = done_tx.send(());
        })
        .unwrap();

    let finished = done_rx.recv_timeout(Duration::from_secs(30));
    stop.store(true, Ordering::Relaxed);
    writer.join().unwrap();
    assert!(finished.is_ok(), "subscribe/unsubscribe hung");
}
