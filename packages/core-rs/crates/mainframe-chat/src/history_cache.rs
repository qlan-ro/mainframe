//! A persistent on-disk cache of a cold chat's already-parsed transcript.
//!
//! `ChatManager::get_messages`'s cold path (`load_history_into_cache`, in
//! `chat_manager/history.rs`) re-parses an adapter's whole transcript from
//! disk every time a chat's in-memory cache is empty — on first open, and
//! again every time the idle scanner offloads it. For a large transcript
//! (tens of MB, thousands of lines) that reparse dominates a cold
//! `session/resume` reply. This module lets a cold load skip the reparse
//! when the transcript hasn't changed since the last time this chat loaded,
//! by persisting the already-converted `Vec<ChatMessage>` next to a
//! [`HistoryFingerprint`] of the files it was built from.
//!
//! ## Correctness
//!
//! - The snapshot is consulted **only** on a cold load (an empty in-memory
//!   cache): `load_history_into_cache` checks `cached_messages` first, same
//!   as before this module existed. While a chat is hot, the in-memory
//!   `MessageCache` stays the single source of truth — this cache is never
//!   read or written on that path.
//! - A fingerprint is the sorted `(path, byte length, mtime)` of every file
//!   [`AdapterSession::history_sources`] reports, plus [`FORMAT_VERSION`] and
//!   this crate's own version. The instant any of those files changes —
//!   append, truncate, or an unrelated edit that merely touches mtime — the
//!   stored fingerprint no longer matches and `read` reports a miss, so the
//!   chat reloads from the transcript exactly as it did before this cache
//!   existed. A fingerprint that cannot be computed (a source stat fails, or
//!   `history_sources` returns nothing) is treated the same as "do not
//!   cache" — the load falls through to a normal parse, neither consulting
//!   nor writing a snapshot.
//! - A snapshot that fails to deserialize, or whose stored fingerprint
//!   doesn't match the freshly computed one, is a miss, not an error: the
//!   caller reparses and (on success) overwrites the stale file.
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use mainframe_types::chat::ChatMessage;
use serde::{Deserialize, Serialize};

/// Bumped whenever the on-disk shape of [`Snapshot`] changes incompatibly —
/// included in the fingerprint so an old snapshot from a prior format is
/// always a miss rather than a failed (or, worse, silently wrong) decode.
const FORMAT_VERSION: u32 = 1;

/// How many chats' snapshots the cache directory keeps. Bounds disk use for
/// installs with a long chat history; newest-by-mtime wins a prune.
const DEFAULT_MAX_SNAPSHOTS: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct SourceFingerprint {
    path: String,
    len: u64,
    mtime_ns: u64,
}

/// What a cached load is pinned to: the exact files `load_history` would
/// read, at the size/mtime they had when the snapshot was written.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct HistoryFingerprint {
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
            format_version: FORMAT_VERSION,
            daemon_version: env!("CARGO_PKG_VERSION").to_string(),
            sources: stats,
        })
    }
}

async fn stat(path: &Path) -> Option<SourceFingerprint> {
    let meta = tokio::fs::metadata(path).await.ok()?;
    let modified = meta.modified().ok()?;
    let mtime_ns = modified
        .duration_since(SystemTime::UNIX_EPOCH)
        .ok()?
        .as_nanos() as u64;
    Some(SourceFingerprint {
        path: path.to_string_lossy().into_owned(),
        len: meta.len(),
        mtime_ns,
    })
}

#[derive(Serialize, Deserialize)]
struct Snapshot {
    fingerprint: HistoryFingerprint,
    messages: Vec<ChatMessage>,
}

/// A directory of `<chat_id>.json` snapshots under `<data_dir>/cache/history`
/// (`ChatManagerDeps::history_cache_dir`). Cheap to clone-share (`Arc`'d by
/// `ChatManager`); every method does its own async I/O, none of it blocking.
pub(crate) struct HistorySnapshotCache {
    dir: PathBuf,
    max_snapshots: usize,
}

impl HistorySnapshotCache {
    pub(crate) fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            max_snapshots: DEFAULT_MAX_SNAPSHOTS,
        }
    }

    #[cfg(test)]
    fn with_max_snapshots(dir: PathBuf, max_snapshots: usize) -> Self {
        Self { dir, max_snapshots }
    }

    fn snapshot_path(&self, chat_id: &str) -> PathBuf {
        self.dir.join(format!("{chat_id}.json"))
    }

    /// `None` on a missing file, a corrupt/unreadable file, or a fingerprint
    /// mismatch — every one of those is "reparse", never an error the caller
    /// has to handle specially.
    pub(crate) async fn read(
        &self,
        chat_id: &str,
        expected: &HistoryFingerprint,
    ) -> Option<Vec<ChatMessage>> {
        let bytes = tokio::fs::read(self.snapshot_path(chat_id)).await.ok()?;
        let snapshot: Snapshot = match serde_json::from_slice(&bytes) {
            Ok(s) => s,
            Err(err) => {
                tracing::warn!(
                    ?err,
                    chat_id,
                    "history snapshot cache: corrupt snapshot, reparsing"
                );
                return None;
            }
        };
        if &snapshot.fingerprint != expected {
            return None;
        }
        Some(snapshot.messages)
    }

    /// Fire-and-forget: spawns the write (+ prune) so a cold load's caller
    /// never waits on it. A failed write only warns — the next cold load
    /// just reparses, same as if this cache didn't exist.
    pub(crate) fn write_in_background(
        self: &Arc<Self>,
        chat_id: String,
        fingerprint: HistoryFingerprint,
        messages: Vec<ChatMessage>,
    ) {
        let cache = Arc::clone(self);
        tokio::spawn(async move {
            if let Err(err) = cache.write(&chat_id, fingerprint, messages).await {
                tracing::warn!(%err, chat_id, "history snapshot cache: write failed");
            }
        });
    }

    async fn write(
        &self,
        chat_id: &str,
        fingerprint: HistoryFingerprint,
        messages: Vec<ChatMessage>,
    ) -> Result<(), String> {
        tokio::fs::create_dir_all(&self.dir)
            .await
            .map_err(|e| e.to_string())?;
        let json = serde_json::to_vec(&Snapshot {
            fingerprint,
            messages,
        })
        .map_err(|e| e.to_string())?;
        // Write-then-rename: a reader never observes a half-written file, and a
        // daemon crash mid-write leaves only an orphaned `.tmp` (next prune's
        // `read_dir` skips it — non-`.json` — so it's inert, not a leak that
        // breaks reads).
        let tmp_path = self.snapshot_path(&format!("{chat_id}.{}.tmp", std::process::id()));
        tokio::fs::write(&tmp_path, &json)
            .await
            .map_err(|e| e.to_string())?;
        tokio::fs::rename(&tmp_path, self.snapshot_path(chat_id))
            .await
            .map_err(|e| e.to_string())?;
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
                tracing::warn!(
                    ?err,
                    path = %path.display(),
                    "history snapshot cache: failed to prune an old snapshot"
                );
            }
        }
    }
}

#[cfg(test)]
#[path = "history_cache_tests.rs"]
mod tests;
