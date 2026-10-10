//! A `notify` watcher observes each subscribed file's parent directory and
//! filters events by filename. Directory watching survives atomic replacement
//! of the file and avoids single-file watch failures on macOS FSEvents. A 200 ms
//! debounce emits one trailing `file:changed` event per burst. Reference counts
//! keep each watcher alive until its final subscriber leaves.

use mainframe_types::sync::LockExt as _;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use mainframe_types::events::DaemonEvent;
use notify::{RecursiveMode, Watcher};
use tokio::runtime::Handle;
use tokio::task::JoinHandle;

const DEBOUNCE_MS: u64 = 200;

type BroadcastFn = Arc<dyn Fn(DaemonEvent) + Send + Sync>;
type WatcherMap = Mutex<HashMap<String, WatchEntry>>;

struct WatchEntry {
    // Held for its lifetime: dropping the watcher stops it (the field is never
    // read directly, but must outlive the subscription).
    _watcher: notify::RecommendedWatcher,
    ref_count: i32,
    debounce: Option<JoinHandle<()>>,
}

/// Manages per-file `notify` watchers on behalf of WS clients. Multiple clients
/// may watch the same path; reference counting ensures the watcher is created
/// once and torn down when the last subscriber leaves.
pub struct FileWatcherService {
    watchers: Arc<WatcherMap>,
    broadcast: BroadcastFn,
    rt: Option<Handle>,
}

impl FileWatcherService {
    pub fn new(broadcast: impl Fn(DaemonEvent) + Send + Sync + 'static) -> Self {
        Self {
            watchers: Arc::new(Mutex::new(HashMap::new())),
            broadcast: Arc::new(broadcast),
            rt: Handle::try_current().ok(),
        }
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, WatchEntry>> {
        self.watchers.lock_recover()
    }

    #[cfg(test)]
    pub(crate) fn is_watching(&self, key: &str) -> bool {
        self.lock().contains_key(key)
    }

    /// Register a watch. `key` is the caller's identity for the subscription (the
    /// realpath'd path used for ref-counting, tear-down, and the emitted
    /// `file:changed` path — i.e. the client contract). `watch_path` is the path
    /// handed to `notify`.
    ///
    /// These differ on macOS: FSEvents can miss a real path under `/private/var`
    /// while the original `/var` symlink path still fires. The caller passes the
    /// real path as `key` for the wire event and the original path as `watch_path`.
    /// On paths without a symlinked prefix the two are equal.
    pub fn subscribe(&self, key: &str, watch_path: &str) {
        {
            let mut map = self.lock();
            if let Some(existing) = map.get_mut(key) {
                existing.ref_count += 1;
                tracing::debug!(
                    module = "file-watcher",
                    path = key,
                    ref_count = existing.ref_count,
                    "file watch ref++"
                );
                return;
            }
        }

        let weak = Arc::downgrade(&self.watchers);
        let broadcast = self.broadcast.clone();
        let rt = self.rt.clone();
        let path_for_cb = key.to_string();

        // macOS FSEvents delivers no events for a single-file watch (and none at
        // all for a directory under the canonicalized `/private/var` form), so we
        // watch the file's parent directory in its original (pre-realpath) form and
        // filter events down to the target file by name. Linux inotify would accept
        // a single-file watch, but the directory form is correct on both. The dir
        // holds exactly one file with this name, so a name match is unambiguous.
        let target_name = Path::new(watch_path)
            .file_name()
            .map(std::ffi::OsStr::to_os_string);
        let watch_target = Path::new(watch_path)
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| Path::new(watch_path).to_path_buf());

        let handler = move |res: notify::Result<notify::Event>| match res {
            Ok(event) => {
                let hit = match &target_name {
                    Some(name) => event
                        .paths
                        .iter()
                        .any(|p| p.file_name() == Some(name.as_os_str())),
                    None => true,
                };
                if hit && let Some(map) = weak.upgrade() {
                    schedule_emit(&map, &path_for_cb, &broadcast, rt.as_ref());
                }
            }
            Err(err) => {
                tracing::warn!(
                    module = "file-watcher",
                    ?err,
                    path = %path_for_cb,
                    "file watcher error"
                );
                if let Some(map) = weak.upgrade() {
                    cleanup(&map, &path_for_cb);
                }
            }
        };

        let mut watcher = match notify::recommended_watcher(handler) {
            Ok(watcher) => watcher,
            Err(err) => {
                tracing::warn!(
                    module = "file-watcher",
                    ?err,
                    path = %key,
                    "failed to start file watcher"
                );
                return;
            }
        };

        if let Err(err) = watcher.watch(&watch_target, RecursiveMode::NonRecursive) {
            tracing::warn!(
                module = "file-watcher",
                ?err,
                path = %watch_path,
                "failed to start file watcher"
            );
            return;
        }

        self.lock().insert(
            key.to_string(),
            WatchEntry {
                _watcher: watcher,
                ref_count: 1,
                debounce: None,
            },
        );
        tracing::debug!(module = "file-watcher", path = key, "file watch started");
    }

    pub fn unsubscribe(&self, absolute_path: &str) {
        {
            let mut map = self.lock();
            let Some(entry) = map.get_mut(absolute_path) else {
                return;
            };
            entry.ref_count -= 1;
            tracing::debug!(
                module = "file-watcher",
                path = absolute_path,
                ref_count = entry.ref_count,
                "file watch ref--"
            );
            if entry.ref_count > 0 {
                return;
            }
        }
        cleanup(&self.watchers, absolute_path);
    }

    pub fn stop_all(&self) {
        let paths: Vec<String> = self.lock().keys().cloned().collect();
        for path in paths {
            cleanup(&self.watchers, &path);
        }
    }
}

fn schedule_emit(map: &Arc<WatcherMap>, path: &str, broadcast: &BroadcastFn, rt: Option<&Handle>) {
    let mut guard = map.lock_recover();
    let Some(entry) = guard.get_mut(path) else {
        return;
    };
    if let Some(handle) = entry.debounce.take() {
        handle.abort();
    }
    match rt {
        // No tokio runtime → emit immediately (debounce needs a runtime). Graceful.
        None => {
            drop(guard);
            (*broadcast)(DaemonEvent::FileChanged {
                path: path.to_string(),
            });
        }
        Some(rt) => {
            let weak = Arc::downgrade(map);
            let broadcast = broadcast.clone();
            let path_owned = path.to_string();
            let handle = rt.spawn(async move {
                tokio::time::sleep(Duration::from_millis(DEBOUNCE_MS)).await;
                if let Some(map) = weak.upgrade() {
                    let mut guard = map.lock_recover();
                    if let Some(entry) = guard.get_mut(&path_owned) {
                        entry.debounce = None;
                    }
                }
                tracing::debug!(
                    module = "file-watcher",
                    path = %path_owned,
                    "file changed, broadcasting"
                );
                (*broadcast)(DaemonEvent::FileChanged {
                    path: path_owned.clone(),
                });
            });
            entry.debounce = Some(handle);
        }
    }
}

fn cleanup(map: &WatcherMap, path: &str) {
    let mut guard = map.lock_recover();
    let Some(mut entry) = guard.remove(path) else {
        return;
    };
    if let Some(handle) = entry.debounce.take() {
        handle.abort();
    }
    // Dropping the watcher closes the subscription.
    drop(entry);
    tracing::debug!(module = "file-watcher", path = path, "file watch stopped");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

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

    async fn wait_for_event(rx: &mpsc::Receiver<DaemonEvent>) -> Option<DaemonEvent> {
        for _ in 0..40 {
            if let Ok(ev) = rx.try_recv() {
                return Some(ev);
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        None
    }

    /// A parent-directory watch keeps emitting `file:changed` after an atomic
    /// rename-over. Two replacements prove it stays armed after the first event.
    #[tokio::test]
    async fn keeps_firing_after_atomic_rename_over() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("watched.txt");
        std::fs::write(&file, b"initial").unwrap();

        let (tx, rx) = mpsc::channel::<DaemonEvent>();
        let svc = FileWatcherService::new(move |ev| {
            let _ = tx.send(ev);
        });
        let path = file.to_str().unwrap().to_string();
        svc.subscribe(&path, &path);
        // Let the FSEvents/kqueue/inotify backend arm before mutating.
        tokio::time::sleep(Duration::from_millis(400)).await;

        let atomic_replace = |body: &[u8], tmp_name: &str| {
            let tmp = dir.path().join(tmp_name);
            std::fs::write(&tmp, body).unwrap();
            std::fs::rename(&tmp, &file).unwrap();
        };

        atomic_replace(b"replaced", "watched.txt.tmp1");
        match wait_for_event(&rx).await {
            Some(DaemonEvent::FileChanged { path: p }) => assert_eq!(p, path),
            other => panic!("expected file:changed after first atomic rename, got {other:?}"),
        }

        // Drain, then a SECOND atomic replace to prove the watch did not go silent
        // (the watcher must stay armed across atomic replacement).
        while rx.try_recv().is_ok() {}
        tokio::time::sleep(Duration::from_millis(300)).await;
        atomic_replace(b"again", "watched.txt.tmp2");
        match wait_for_event(&rx).await {
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
        let svc = FileWatcherService::new(|_| {});
        let p = file.to_str().unwrap();
        svc.subscribe(p, p);
        svc.subscribe(p, p); // ref_count 2
        tokio::time::sleep(Duration::from_millis(400)).await;

        let tmp = dir.path().join("watched.txt.tmp");
        std::fs::write(&tmp, b"replaced").unwrap();
        std::fs::rename(&tmp, &file).unwrap();
        tokio::time::sleep(Duration::from_millis(200)).await;

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

        let (tx, rx) = mpsc::channel::<DaemonEvent>();
        let svc = FileWatcherService::new(move |ev| {
            let _ = tx.send(ev);
        });
        let path = file.to_str().unwrap().to_string();
        svc.subscribe(&path, &path);

        // Let the FSEvents/kqueue backend arm before mutating.
        tokio::time::sleep(Duration::from_millis(400)).await;
        std::fs::write(&file, b"changed").unwrap();

        // Poll for the debounced broadcast (allow for backend latency).
        let mut got: Option<DaemonEvent> = None;
        for _ in 0..50 {
            if let Ok(ev) = rx.try_recv() {
                got = Some(ev);
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        svc.stop_all();

        match got {
            Some(DaemonEvent::FileChanged { path: p }) => assert_eq!(p, path),
            other => panic!("expected a file:changed event for the modified file, got {other:?}"),
        }
    }
}
