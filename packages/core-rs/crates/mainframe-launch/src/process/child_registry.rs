//! Ported from `src/process/child-registry.ts`.
//!
//! A persistent pidfile of daemon-spawned children (tunnels + launch configs),
//! written at spawn and pruned on stop. It survives daemon crashes so the next
//! startup sweep (`process::sweep`) can reap children this daemon leaked. Writes
//! are serialized (a `tokio::sync::Mutex` stands in for the TS mutating tail
//! promise) and atomic (temp file + rename) so concurrent spawns across the
//! tunnel and launch managers never interleave. Records that fail validation (a
//! corrupt file, or a stale pre-generalization cloudflared entry) are dropped on
//! read rather than crashing the daemon.
//!
//! `ChildRegistryPort` is object-safe via manually boxed futures (`BoxFuture`) so
//! the tunnel/launch managers can hold an `Arc<dyn ChildRegistryPort>` without an
//! `async-trait` dependency. The methods are infallible (no `Result`): the TS
//! callers all `.catch()`-and-log, and `read`/`write` failures are logged inside
//! `FileChildRegistry` and swallowed — the same effect.

use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

/// Boxed future returned by the object-safe `ChildRegistryPort` methods.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Epoch milliseconds, matching JS `Date.now()`.
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

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
/// (mirroring the TS tail-promise) so concurrent tunnel/launch spawns never
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
                tracing::warn!(target: "child-registry", ?err, file = %self.file, "child registry read failed, treating as empty");
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
                tracing::warn!(target: "child-registry", ?err, file = %self.file, "child registry is corrupt, treating as empty");
                Vec::new()
            }
        }
    }

    async fn write(&self, entries: &[ManagedChildEntry]) {
        if let Some(parent) = Path::new(&self.file).parent()
            && !parent.as_os_str().is_empty()
            && let Err(err) = tokio::fs::create_dir_all(parent).await
        {
            tracing::warn!(target: "child-registry", ?err, file = %self.file, "child registry mkdir failed");
            return;
        }
        let json = match serde_json::to_string(entries) {
            Ok(json) => json,
            Err(err) => {
                tracing::warn!(target: "child-registry", ?err, file = %self.file, "child registry serialize failed");
                return;
            }
        };
        let tmp = format!("{}.{}.tmp", self.file, std::process::id());
        if let Err(err) = tokio::fs::write(&tmp, json).await {
            tracing::warn!(target: "child-registry", ?err, file = %self.file, "child registry write failed");
            return;
        }
        if let Err(err) = tokio::fs::rename(&tmp, &self.file).await {
            tracing::warn!(target: "child-registry", ?err, file = %self.file, "child registry rename failed");
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
mod tests {
    use super::*;

    fn tunnel_entry(pid: i64) -> ManagedChildEntry {
        tunnel_entry_labeled(pid, format!("preview:{pid}"))
    }

    fn tunnel_entry_labeled(pid: i64, label: String) -> ManagedChildEntry {
        ManagedChildEntry {
            pid,
            kind: ManagedChildKind::Tunnel,
            command: "/home/user/.mainframe/bin/bin/cloudflared".to_string(),
            args: vec![],
            cwd: None,
            group: false,
            label,
            spawned_at: 1_000,
        }
    }

    fn launch_entry(pid: i64) -> ManagedChildEntry {
        launch_entry_named(pid, format!("dev-{pid}"))
    }

    fn launch_entry_named(pid: i64, name: String) -> ManagedChildEntry {
        ManagedChildEntry {
            pid,
            kind: ManagedChildKind::Launch,
            command: "/opt/homebrew/bin/pnpm".to_string(),
            args: vec!["run".to_string(), "dev".to_string()],
            cwd: Some("/Users/me/project".to_string()),
            group: true,
            label: format!("proj:{name}"),
            spawned_at: 2_000,
        }
    }

    fn temp_file() -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("managed-children.json");
        (dir, file.to_string_lossy().into_owned())
    }

    #[tokio::test]
    async fn list_returns_empty_when_the_file_does_not_exist() {
        let (_dir, file) = temp_file();
        let registry = FileChildRegistry::new(file);
        assert_eq!(registry.list().await, vec![]);
    }

    #[tokio::test]
    async fn persists_entries_of_both_kinds_across_instances() {
        let (_dir, file) = temp_file();
        let registry = FileChildRegistry::new(file.clone());
        registry.add(tunnel_entry(111)).await;
        registry.add(launch_entry(222)).await;
        let reopened = FileChildRegistry::new(file);
        assert_eq!(
            reopened.list().await,
            vec![tunnel_entry(111), launch_entry(222)]
        );
    }

    #[tokio::test]
    async fn list_by_kind_filters_by_kind() {
        let (_dir, file) = temp_file();
        let registry = FileChildRegistry::new(file);
        registry.add(tunnel_entry(111)).await;
        registry.add(launch_entry(222)).await;
        assert_eq!(
            registry.list_by_kind(ManagedChildKind::Launch).await,
            vec![launch_entry(222)]
        );
        assert_eq!(
            registry.list_by_kind(ManagedChildKind::Tunnel).await,
            vec![tunnel_entry(111)]
        );
    }

    #[tokio::test]
    async fn remove_drops_only_the_matching_pid() {
        let (_dir, file) = temp_file();
        let registry = FileChildRegistry::new(file);
        registry.add(tunnel_entry(111)).await;
        registry.add(launch_entry(222)).await;
        registry.remove(111).await;
        assert_eq!(registry.list().await, vec![launch_entry(222)]);
    }

    #[tokio::test]
    async fn replaces_an_existing_entry_with_the_same_pid_rather_than_duplicating() {
        let (_dir, file) = temp_file();
        let registry = FileChildRegistry::new(file);
        registry
            .add(launch_entry_named(111, "first".to_string()))
            .await;
        registry
            .add(launch_entry_named(111, "second".to_string()))
            .await;
        let list = registry.list().await;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].label, "proj:second");
    }

    #[tokio::test]
    async fn clear_empties_the_registry() {
        let (_dir, file) = temp_file();
        let registry = FileChildRegistry::new(file);
        registry.add(tunnel_entry(111)).await;
        registry.clear().await;
        assert_eq!(registry.list().await, vec![]);
    }

    #[tokio::test]
    async fn does_not_lose_entries_under_concurrent_adds() {
        let (_dir, file) = temp_file();
        let registry = std::sync::Arc::new(FileChildRegistry::new(file));
        let mut handles = vec![];
        for pid in 1..=5 {
            let registry = registry.clone();
            handles.push(tokio::spawn(async move {
                registry.add(launch_entry(pid)).await;
            }));
        }
        for handle in handles {
            handle.await.unwrap();
        }
        let mut pids: Vec<i64> = registry.list().await.into_iter().map(|e| e.pid).collect();
        pids.sort_unstable();
        assert_eq!(pids, vec![1, 2, 3, 4, 5]);
    }

    #[tokio::test]
    async fn tolerates_a_corrupt_registry_file_and_treats_it_as_empty() {
        let (_dir, file) = temp_file();
        tokio::fs::write(&file, "not json{{{").await.unwrap();
        let registry = FileChildRegistry::new(file);
        assert_eq!(registry.list().await, vec![]);
        registry.add(tunnel_entry(111)).await;
        assert_eq!(registry.list().await, vec![tunnel_entry(111)]);
    }

    #[tokio::test]
    async fn tolerates_a_stale_old_format_cloudflared_registry_file() {
        // The pre-generalization format was { pid, label, binPath, spawnedAt } —
        // no kind/command/args/cwd/group. Such entries must be dropped, not crash.
        let (_dir, file) = temp_file();
        let stale = serde_json::json!([
            { "pid": 999, "label": "daemon", "binPath": "/x/cloudflared", "spawnedAt": 1 },
            launch_entry(5),
        ]);
        tokio::fs::write(&file, serde_json::to_string(&stale).unwrap())
            .await
            .unwrap();
        let registry = FileChildRegistry::new(file);
        assert_eq!(registry.list().await, vec![launch_entry(5)]);
    }

    #[tokio::test]
    async fn drops_malformed_entries_when_reading() {
        let (_dir, file) = temp_file();
        let mixed = serde_json::json!([
            tunnel_entry(111),
            { "pid": "nope" },
            { "kind": "launch" },
            null,
        ]);
        tokio::fs::write(&file, serde_json::to_string(&mixed).unwrap())
            .await
            .unwrap();
        let registry = FileChildRegistry::new(file);
        assert_eq!(registry.list().await, vec![tunnel_entry(111)]);
    }

    #[tokio::test]
    async fn writes_atomically_without_leaving_a_tmp_file_behind() {
        let (_dir, file) = temp_file();
        let registry = FileChildRegistry::new(file.clone());
        registry.add(tunnel_entry(111)).await;
        let contents = tokio::fs::read_to_string(&file).await.unwrap();
        let parsed: Vec<ManagedChildEntry> = serde_json::from_str(&contents).unwrap();
        assert_eq!(parsed, vec![tunnel_entry(111)]);
    }

    #[tokio::test]
    async fn noop_registry_is_inert() {
        let registry = NoopChildRegistry;
        registry.add(tunnel_entry(1)).await;
        registry.remove(1).await;
        registry.clear().await;
        assert_eq!(registry.list().await, vec![]);
        assert_eq!(
            registry.list_by_kind(ManagedChildKind::Launch).await,
            vec![]
        );
    }
}

// PORT STATUS: src/process/child-registry.ts (147 lines)
// confidence: high
// todos: 0
// notes: ManagedChildEntry/ManagedChildKind serde structs (camelCase; kind
// lowercase; cwd serialized as explicit null per the round-trip test). The TS
// tail-promise serialization becomes a tokio::sync::Mutex held across each
// read-modify-write; atomic write = tmp (pid-suffixed) + rename via tokio::fs.
// Drop-on-read of malformed/stale entries = per-element serde_json::from_value
// (missing required non-Option fields → dropped). ChildRegistryPort is
// object-safe via manually boxed BoxFuture (no async-trait dep); methods are
// infallible — FileChildRegistry logs+swallows read/write errors (the TS callers
// all .catch()-and-log, same effect). All child-registry.test.ts cases ported.
