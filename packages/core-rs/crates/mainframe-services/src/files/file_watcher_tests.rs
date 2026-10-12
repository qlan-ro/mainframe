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
    svc.stop_all();
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
    svc.stop_all();
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
async fn stop_all_closes_all_watchers() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("a.ts");
    touch(&file);
    let svc = FileWatcherService::new(|_| {});
    svc.subscribe(file.to_str().unwrap(), file.to_str().unwrap());
    svc.stop_all();
    assert!(!svc.is_watching(file.to_str().unwrap()));
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
    svc.stop_all();
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
    svc.stop_all();

    match got {
        Some(DaemonEvent::FileChanged { path: p }) => assert_eq!(p, path),
        other => panic!("expected a file:changed event for the modified file, got {other:?}"),
    }
}
