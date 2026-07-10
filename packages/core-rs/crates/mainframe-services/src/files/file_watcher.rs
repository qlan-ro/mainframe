//! Ported from `src/files/file-watcher.ts`.
//!
//! Node's per-file `fs.watch` becomes a `notify` watcher per subscription. To
//! stay reliable on macOS FSEvents (which drops single-file watches) the watcher
//! is placed on the file's parent directory and events are filtered to the target
//! file by name; the event mapping and 200ms debounce are otherwise mirrored: any
//! inbound change schedules a single trailing `file:changed` broadcast, and the
//! reference count keeps one watcher per key and tears it down when the last
//! subscriber leaves.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
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
    #[allow(dead_code)]
    watcher: notify::RecommendedWatcher,
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
        self.watchers.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn is_watching(&self, key: &str) -> bool {
        self.lock().contains_key(key)
    }

    /// Register a watch. `key` is the caller's identity for the subscription (the
    /// realpath'd path used for ref-counting, tear-down, and the emitted
    /// `file:changed` path — i.e. the client contract). `watch_path` is the path
    /// handed to `notify`.
    ///
    /// These differ on purpose: Node's `fs.watch` and the `notify` FSEvents
    /// backend disagree on macOS single-file watches — FSEvents delivers no events
    /// for a real-path under `/private/var`, but does for the `/var` symlink form
    /// libuv accepts. The caller (ws-file-watch) therefore passes the realpath as
    /// `key` (unchanged wire behavior) and the original pre-realpath path as
    /// `watch_path` so the backend actually fires. On paths without a symlinked
    /// prefix (the normal case) the two are equal.
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
                watcher,
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
    let mut guard = map.lock().unwrap_or_else(PoisonError::into_inner);
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
                    let mut guard = map.lock().unwrap_or_else(PoisonError::into_inner);
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
    let mut guard = map.lock().unwrap_or_else(PoisonError::into_inner);
    let Some(mut entry) = guard.remove(path) else {
        return;
    };
    if let Some(handle) = entry.debounce.take() {
        handle.abort();
    }
    // Dropping the watcher closes it (Node's `watcher.close()`).
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

    /// macOS behavior test: create + modify a real file in a tempdir and assert a
    /// debounced `file:changed` event is emitted for it (verifies the notify event
    /// mapping matches Node's `fs.watch`).
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

// PORT STATUS: src/files/file-watcher.ts (102 lines)
// confidence: medium
// todos: 0
// notes: fs.watch → notify RecommendedWatcher per path (SHARED_MAP class:
// Arc<Mutex<HashMap>>; §3.3 allows RwLock<HashMap>, Mutex chosen for the
// mutate-heavy entries). The notify callback runs on the backend thread and holds
// only a Weak to the map (no Arc cycle → no leak; the strong Arc lives in the
// service and drops with it). 200ms trailing debounce via a spawned task whose
// JoinHandle is stored for abort (clearTimeout). Emit needs a tokio runtime
// (captured Handle); without one it broadcasts immediately (graceful). Same
// debug/warn messages as the TS. The macОС behavior test drives a real file
// modify; the refcount/lifecycle tests use real (existing) temp files since
// notify.watch (unlike the TS mock) fails on a missing path.
