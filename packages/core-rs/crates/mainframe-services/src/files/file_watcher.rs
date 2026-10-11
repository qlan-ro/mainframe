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

        let handler = watch_handler(weak, broadcast, rt, path_for_cb, target_name);

        let mut watcher = match notify::recommended_watcher(handler) {
            Ok(watcher) => watcher,
            Err(err) => {
                tracing::warn!( error = ?err,
                    path = %key,
                    "failed to start file watcher"
                );
                return;
            }
        };

        if let Err(err) = watcher.watch(&watch_target, RecursiveMode::NonRecursive) {
            tracing::warn!( error = ?err,
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
        tracing::debug!(path = key, "file watch started");
    }

    pub fn unsubscribe(&self, absolute_path: &str) {
        {
            let mut map = self.lock();
            let Some(entry) = map.get_mut(absolute_path) else {
                return;
            };
            entry.ref_count -= 1;
            tracing::debug!(
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
    tracing::debug!(path = path, "file watch stopped");
}

#[cfg(test)]
#[path = "file_watcher_tests.rs"]
mod tests;

fn watch_handler(
    weak: std::sync::Weak<WatcherMap>,
    broadcast: BroadcastFn,
    rt: Option<Handle>,
    path_for_cb: String,
    target_name: Option<std::ffi::OsString>,
) -> impl FnMut(notify::Result<notify::Event>) + Send + 'static {
    move |res: notify::Result<notify::Event>| match res {
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
            tracing::warn!( error = ?err,
                path = %path_for_cb,
                "file watcher error"
            );
            if let Some(map) = weak.upgrade() {
                cleanup(&map, &path_for_cb);
            }
        }
    }
}
