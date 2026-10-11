//! A persistent pidfile of daemon-spawned children (tunnels + launch configs),
//! written at spawn and pruned on stop. It survives daemon crashes so the next
//! startup sweep (`process::sweep`) can reap children this daemon leaked. Writes
//! are serialized (a `tokio::sync::Mutex`) and atomic (temp file + rename)
//! so concurrent spawns across the
//! tunnel and launch managers never interleave. Records that fail validation (a
//! corrupt file, or a stale pre-generalization cloudflared entry) are dropped on
//! read rather than crashing the daemon.
//!
//! `ChildRegistryPort` is object-safe via manually boxed futures (`BoxFuture`) so
//! the tunnel/launch managers can hold an `Arc<dyn ChildRegistryPort>` without an
//! `async-trait` dependency. The methods are infallible (no `Result`): callers
//! could only log a failure, so `read`/`write` failures are logged inside
//! `FileChildRegistry` and swallowed.

use std::path::Path;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

/// Boxed future returned by the object-safe `ChildRegistryPort` methods.
pub use mainframe_types::BoxFuture;

/// Epoch milliseconds.
pub use mainframe_types::time::now_ms;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ManagedChildKind {
    Tunnel,
    Launch,
}

/// One persistent record of a daemon-spawned child process. It carries enough
/// identity for a startup sweep to reap the child SAFELY after a daemon crash —
/// the exact argv and cwd so the sweep can reject a PID reused by an unrelated
/// process (see `process::sweep`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedChildEntry {
    pub pid: i64,
    pub kind: ManagedChildKind,
    /// argv[0] — an absolute executable path when known. A bare name still
    /// records but weakens the sweep guard.
    pub command: String,
    /// argv after the executable, exactly as spawned.
    pub args: Vec<String>,
    /// Working directory the child was spawned in, or `null` when not tracked
    /// (tunnels). Serialized as an explicit `null` (a fixture shows it), never
    /// omitted.
    pub cwd: Option<String>,
    /// Reap the child's whole process group (`kill(-pid)`) on sweep — set for
    /// detached launch trees.
    pub group: bool,
    /// Human-facing label/scope for logs (tunnel label, or `${projectId}:${name}`).
    pub label: String,
    pub spawned_at: i64,
}

/// Persistent registry of live daemon-spawned children.
pub trait ChildRegistryPort: Send + Sync {
    fn add(&self, entry: ManagedChildEntry) -> BoxFuture<'_, ()>;
    fn remove(&self, pid: i64) -> BoxFuture<'_, ()>;
    fn list(&self) -> BoxFuture<'_, Vec<ManagedChildEntry>>;
    fn list_by_kind(&self, kind: ManagedChildKind) -> BoxFuture<'_, Vec<ManagedChildEntry>>;
    fn clear(&self) -> BoxFuture<'_, ()>;
}

/// Inert registry for callers (and tests) that don't persist child pids.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoopChildRegistry;

impl ChildRegistryPort for NoopChildRegistry {
    fn add(&self, _entry: ManagedChildEntry) -> BoxFuture<'_, ()> {
        Box::pin(async {})
    }
    fn remove(&self, _pid: i64) -> BoxFuture<'_, ()> {
        Box::pin(async {})
    }
    fn list(&self) -> BoxFuture<'_, Vec<ManagedChildEntry>> {
        Box::pin(async { Vec::new() })
    }
    fn list_by_kind(&self, _kind: ManagedChildKind) -> BoxFuture<'_, Vec<ManagedChildEntry>> {
        Box::pin(async { Vec::new() })
    }
    fn clear(&self) -> BoxFuture<'_, ()> {
        Box::pin(async {})
    }
}

/// Pidfile-backed registry. Every operation takes the serialization `Mutex`
/// so concurrent tunnel/launch spawns never
/// interleave a read-modify-write.
pub struct FileChildRegistry {
    file: String,
    lock: Mutex<()>,
}

impl FileChildRegistry {
    pub fn new(file: impl Into<String>) -> Self {
        Self {
            file: file.into(),
            lock: Mutex::new(()),
        }
    }

    async fn read(&self) -> Vec<ManagedChildEntry> {
        let raw = match tokio::fs::read_to_string(&self.file).await {
            Ok(raw) => raw,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
            Err(err) => {
                tracing::warn!(error = ?err, file = %self.file, "child registry read failed, treating as empty");
                return Vec::new();
            }
        };
        match serde_json::from_str::<serde_json::Value>(&raw) {
            Ok(serde_json::Value::Array(items)) => items
                .into_iter()
                .filter_map(|item| serde_json::from_value::<ManagedChildEntry>(item).ok())
                .collect(),
            Ok(_) => Vec::new(),
            Err(err) => {
                tracing::warn!(error = ?err, file = %self.file, "child registry is corrupt, treating as empty");
                Vec::new()
            }
        }
    }

    async fn write(&self, entries: &[ManagedChildEntry]) {
        if let Some(parent) = Path::new(&self.file).parent()
            && !parent.as_os_str().is_empty()
            && let Err(err) = tokio::fs::create_dir_all(parent).await
        {
            tracing::warn!(error = ?err, file = %self.file, "child registry mkdir failed");
            return;
        }
        let json = match serde_json::to_string(entries) {
            Ok(json) => json,
            Err(err) => {
                tracing::warn!(error = ?err, file = %self.file, "child registry serialize failed");
                return;
            }
        };
        if let Err(err) =
            mainframe_runtime::fs::write_atomic(Path::new(&self.file), json.as_bytes(), false).await
        {
            match err.stage {
                mainframe_runtime::fs::AtomicWriteStage::Write => {
                    tracing::warn!(error = ?err.source, file = %self.file, "child registry write failed");
                }
                mainframe_runtime::fs::AtomicWriteStage::Rename => {
                    tracing::warn!(error = ?err.source, file = %self.file, "child registry rename failed");
                }
            }
        }
    }
}

impl ChildRegistryPort for FileChildRegistry {
    fn add(&self, entry: ManagedChildEntry) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            let _guard = self.lock.lock().await;
            let mut entries = self.read().await;
            entries.retain(|e| e.pid != entry.pid);
            entries.push(entry);
            self.write(&entries).await;
        })
    }

    fn remove(&self, pid: i64) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            let _guard = self.lock.lock().await;
            let mut entries = self.read().await;
            entries.retain(|e| e.pid != pid);
            self.write(&entries).await;
        })
    }

    fn list(&self) -> BoxFuture<'_, Vec<ManagedChildEntry>> {
        Box::pin(async move {
            let _guard = self.lock.lock().await;
            self.read().await
        })
    }

    fn list_by_kind(&self, kind: ManagedChildKind) -> BoxFuture<'_, Vec<ManagedChildEntry>> {
        Box::pin(async move {
            self.list()
                .await
                .into_iter()
                .filter(|e| e.kind == kind)
                .collect()
        })
    }

    fn clear(&self) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            let _guard = self.lock.lock().await;
            self.write(&[]).await;
        })
    }
}

#[cfg(test)]
#[path = "child_registry_tests.rs"]
mod tests;
