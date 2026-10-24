//! Persist converted history only while its source and dependency stamps remain current.
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use mainframe_types::chat::ChatMessage;
use serde::{Deserialize, Serialize};

/// Bumped whenever the on-disk shape of [`Snapshot`] changes incompatibly,
/// or history conversion adds data the stored messages lack (2: Claude
/// prompt-group `turnGroup` metadata) — included in the fingerprint so an
/// old snapshot is always a miss rather than a failed (or, worse, silently
/// wrong) decode.
const FORMAT_VERSION: u32 = 3;

/// How many chats' snapshots the cache directory keeps. Bounds disk use for
/// installs with a long chat history; newest-by-mtime wins a prune.
const DEFAULT_MAX_SNAPSHOTS: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct SourceFingerprint {
    path: String,
    len: u64,
    mtime_ns: u64,
    identity: Option<[u64; 4]>,
}

/// What a cached load is pinned to: the exact files `load_history` would
/// read, at the size/mtime they had when the snapshot was written.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct HistoryFingerprint {
    #[serde(default)]
    context: String,
    format_version: u32,
    daemon_version: String,
    /// Sorted by `path` — `history_sources`' own order isn't guaranteed
    /// stable (a directory listing), so comparing fingerprints structurally
    /// (`==`) would otherwise false-miss on a mere reordering.
    sources: Vec<SourceFingerprint>,
}

impl HistoryFingerprint {
    /// `None` when `sources` is empty (the adapter opted out — see the
    /// trait's own doc) or when any source can't be stat'd (deleted,
    /// permission error, or a pre-1970 mtime `SystemTime` can't subtract):
    /// both cases mean "do not cache" for this load, same as a disabled
    /// cache would.
    pub(crate) async fn compute(sources: &[PathBuf]) -> Option<Self> {
        if sources.is_empty() {
            return None;
        }
        let mut stats = Vec::with_capacity(sources.len());
        for path in sources {
            stats.push(stat(path).await?);
        }
        stats.sort_by(|a, b| a.path.cmp(&b.path));
        Some(Self {
            context: String::new(),
            format_version: FORMAT_VERSION,
            daemon_version: env!("CARGO_PKG_VERSION").to_string(),
            sources: stats,
        })
    }
}

async fn stat(path: &Path) -> Option<SourceFingerprint> {
    let source = mainframe_adapter_api::HistoryDependency::capture(path.to_path_buf()).await?;
    let mtime_ns = source
        .modified
        .duration_since(SystemTime::UNIX_EPOCH)
        .ok()?
        .as_nanos() as u64;
    Some(SourceFingerprint {
        path: path.to_string_lossy().into_owned(),
        len: source.len,
        mtime_ns,
        identity: source.identity,
    })
}

#[derive(Serialize, Deserialize)]
struct Snapshot {
    adapter_state: serde_json::Value,
    dependencies: Vec<mainframe_adapter_api::HistoryDependency>,
    fingerprint: HistoryFingerprint,
    messages: Vec<ChatMessage>,
}

/// A directory of `<chat_id>.json` snapshots under `<data_dir>/cache/history`
/// (`ProjectPaths::history_cache_dir`). Cheap to clone-share (`Arc`'d by
/// `ChatManager`); every method does its own async I/O, none of it blocking.
pub(crate) struct HistorySnapshotCache {
    #[cfg(test)]
    writes: std::sync::Mutex<Vec<tokio::task::JoinHandle<()>>>,
    dir: PathBuf,
    max_snapshots: usize,
}

impl HistorySnapshotCache {
    pub(crate) fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            max_snapshots: DEFAULT_MAX_SNAPSHOTS,
            #[cfg(test)]
            writes: std::sync::Mutex::default(),
        }
    }

    #[cfg(test)]
    fn with_max_snapshots(dir: PathBuf, max_snapshots: usize) -> Self {
        Self {
            dir,
            max_snapshots,
            writes: std::sync::Mutex::default(),
        }
    }

    pub(super) fn snapshot_path(&self, chat_id: &str) -> PathBuf {
        self.dir.join(format!("{chat_id}.json"))
    }

    /// `None` on a missing file, a corrupt/unreadable file, or a fingerprint
    /// mismatch — every one of those is "reparse", never an error the caller
    /// has to handle specially.
    #[cfg(test)]
    pub(crate) async fn read(
        &self,
        chat_id: &str,
        expected: &HistoryFingerprint,
    ) -> Option<Vec<ChatMessage>> {
        self.read_candidate(chat_id, expected)
            .await
            .map(|snapshot| snapshot.messages)
    }

    async fn read_candidate(
        &self,
        chat_id: &str,
        expected: &HistoryFingerprint,
    ) -> Option<Snapshot> {
        let bytes = tokio::fs::read(self.snapshot_path(chat_id)).await.ok()?;
        let snapshot: Snapshot =
            match tokio::task::spawn_blocking(move || serde_json::from_slice(&bytes))
                .await
                .ok()?
            {
                Ok(s) => s,
                Err(err) => {
                    tracing::warn!(error = ?err,
                        chat_id,
                        "corrupt snapshot, reparsing"
                    );
                    return None;
                }
            };
        if &snapshot.fingerprint != expected {
            return None;
        }
        for source in &snapshot.dependencies {
            if !source.is_current().await {
                return None;
            }
        }
        Some(snapshot)
    }

    /// Fire-and-forget: spawns the write (+ prune) so a cold load's caller
    /// never waits on it. A failed write only warns — the next cold load
    /// just reparses, same as if this cache didn't exist.
    pub(crate) fn write_in_background(
        self: &Arc<Self>,
        chat_id: String,
        fingerprint: HistoryFingerprint,
        messages: Vec<ChatMessage>,
        dependencies: Vec<mainframe_adapter_api::HistoryDependency>,
        adapter_state: serde_json::Value,
    ) {
        let cache = Arc::clone(self);
        let handle = tokio::spawn(async move {
            if let Err(err) = cache
                .write_snapshot(
                    &chat_id,
                    Snapshot {
                        fingerprint,
                        messages,
                        dependencies,
                        adapter_state,
                    },
                )
                .await
            {
                tracing::warn!(error = %err, chat_id, "write failed");
            }
        });
        #[cfg(test)]
        self.writes.lock().unwrap().push(handle);
        #[cfg(not(test))]
        drop(handle);
    }

    #[cfg(test)]
    pub(crate) async fn flush(&self) {
        let writes = std::mem::take(&mut *self.writes.lock().unwrap());
        for write in writes {
            write.await.unwrap();
        }
    }

    #[cfg(test)]
    async fn write(
        &self,
        chat_id: &str,
        fingerprint: HistoryFingerprint,
        messages: Vec<ChatMessage>,
    ) -> Result<(), SnapshotWriteError> {
        self.write_snapshot(
            chat_id,
            Snapshot {
                fingerprint,
                messages,
                dependencies: Vec::new(),
                adapter_state: serde_json::Value::Null,
            },
        )
        .await
    }

    async fn write_snapshot(
        &self,
        chat_id: &str,
        snapshot: Snapshot,
    ) -> Result<(), SnapshotWriteError> {
        tokio::fs::create_dir_all(&self.dir).await?;
        let json = tokio::task::spawn_blocking(move || serde_json::to_vec(&snapshot))
            .await
            .map_err(|error| std::io::Error::other(error.to_string()))??;
        mainframe_runtime::fs::write_atomic(&self.snapshot_path(chat_id), &json, false).await?;
        self.prune().await;
        Ok(())
    }

    /// Keeps only the newest `max_snapshots` `*.json` files by mtime. Runs
    /// after every write, so the directory never grows past the bound by
    /// more than the handful of writes in flight at once.
    async fn prune(&self) {
        let Ok(mut entries) = tokio::fs::read_dir(&self.dir).await else {
            return;
        };
        let mut files: Vec<(PathBuf, SystemTime)> = Vec::new();
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            if let Ok(meta) = entry.metadata().await
                && let Ok(modified) = meta.modified()
            {
                files.push((path, modified));
            }
        }
        if files.len() <= self.max_snapshots {
            return;
        }
        files.sort_by_key(|(_, modified)| std::cmp::Reverse(*modified));
        for (path, _) in files.into_iter().skip(self.max_snapshots) {
            if let Err(err) = tokio::fs::remove_file(&path).await {
                tracing::warn!(error = ?err,
                    path = %path.display(),
                    "failed to prune an old snapshot"
                );
            }
        }
    }
}

#[cfg(test)]
#[path = "history_cache_tests.rs"]
mod tests;

/// Why a history snapshot could not be written; logged, never surfaced.
#[derive(Debug, thiserror::Error)]
enum SnapshotWriteError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Write(#[from] mainframe_runtime::fs::AtomicWriteError),
}

#[path = "history_cache_load.rs"]
mod load;
