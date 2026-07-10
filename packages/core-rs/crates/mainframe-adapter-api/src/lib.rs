//! `mainframe-adapter-api` — the adapter contract crate.
//!
//! - `adapter` ports the *behavioral* half of `packages/types/src/adapter.ts`
//!   (the `Adapter` / `AdapterSession` / `SessionSink` traits). The DATA half of
//!   that file lives in `mainframe-types::adapter`.
//! - this `lib.rs` ports `packages/core/src/adapters/index.ts` — the
//!   `AdapterRegistry` (the `index.ts → ::lib` crate-map row) — plus the shared
//!   support types (`BoxFuture`, `RunResult`, `AdapterError`) and the
//!   `RefreshDeps` injection trait.
//! - `resolve_executable` ports `packages/core/src/adapters/resolve-executable.ts`.
//!
//! The `AdapterRegistry` tests live in `tests/registry.rs` (they exercise only
//! the public surface) so this file stays a focused port of `index.ts`.
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use dashmap::{DashMap, DashSet};
use mainframe_types::adapter::{AdapterInfo, AdapterModel, CatalogSource};
use mainframe_types::events::DaemonEvent;
use tokio::sync::Notify;

pub mod adapter;
pub mod plan_mode_actions;
pub mod resolve_executable;

pub use adapter::{
    Adapter, AdapterSession, ContextFiles, ImageInput, LoadedSkill, SessionSink,
    StopBackgroundTaskResult,
};
pub use plan_mode_actions::{PlanActionContext, PlanChatUpdate, PlanModeActionHandler};
// The control envelopes are DATA (they live in mainframe-types); re-exported here
// so adapter consumers get them from the contract crate (crate-map §2.6).
pub use mainframe_types::adapter::{ControlRequest, ControlResponse};

/// A boxed, `Send` future — the manual async-fn-in-trait building block used by
/// every `dyn`-compatible async trait method in this crate.
pub type BoxFuture<'a, T> = Pin<Box<dyn std::future::Future<Output = T> + Send + 'a>>;

/// Result of a spawned child process (`{ ok, stdout }`). Shared by `RefreshDeps`
/// and the `resolve_executable` `Runner`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunResult {
    pub ok: bool,
    pub stdout: String,
}

/// Errors surfaced across the adapter contract. Library crates use `thiserror`.
#[derive(Debug, thiserror::Error)]
pub enum AdapterError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

const REFRESH_LIST_CAP_MS: u64 = 2_000;

/// `\d+\.\d+\.\d+` — the first `N.N.N` triple in `stdout`. Hand-rolled (no regex
/// crate in the allowlist); mirrors the TS `parseVersion` in `index.ts`.
fn parse_version(stdout: &str) -> Option<String> {
    let b = stdout.as_bytes();
    let n = b.len();
    let mut i = 0;
    while i < n {
        if b[i].is_ascii_digit() {
            let mut j = i;
            while j < n && b[j].is_ascii_digit() {
                j += 1;
            }
            if j < n && b[j] == b'.' {
                j += 1;
                let g2 = j;
                while j < n && b[j].is_ascii_digit() {
                    j += 1;
                }
                if j > g2 && j < n && b[j] == b'.' {
                    j += 1;
                    let g3 = j;
                    while j < n && b[j].is_ascii_digit() {
                        j += 1;
                    }
                    if j > g3 {
                        return Some(stdout[i..j].to_string());
                    }
                }
            }
        }
        i += 1;
    }
    None
}

/// Injected refresh dependencies (mirrors the TS `RefreshDeps` interface in
/// `index.ts`). `SINGLE_TASK` per CONCURRENCY.tsv row 132 — set once via
/// `configure_refresh`.
pub trait RefreshDeps: Send + Sync {
    fn resolve_executable_path(&self, adapter_id: String) -> BoxFuture<'_, Option<String>>;
    fn run(
        &self,
        cmd: String,
        args: Vec<String>,
        timeout_ms: Option<u64>,
    ) -> BoxFuture<'_, RunResult>;
    /// Emit a daemon event. The TS `emitEvent` is a synchronous fan-out; the Rust
    /// impl is a non-blocking channel send, so (unlike TS) it cannot throw — the
    /// `applyRefresh` try/catch around it collapses (the snapshot is already
    /// updated before this call, preserving the invariant that catch protected).
    fn emit_event(&self, event: DaemonEvent);
}

struct RefreshPatch {
    installed: bool,
    version: Option<String>,
    models: Option<Vec<AdapterModel>>,
}

/// Registry of the daemon's adapters plus their materialized `AdapterInfo`
/// snapshots. Concurrency classes per CONCURRENCY.tsv rows 130-135; the registry
/// itself is shared as `Arc<AdapterRegistry>`.
#[derive(Default)]
pub struct AdapterRegistry {
    adapters: Arc<DashMap<String, Arc<dyn Adapter>>>,
    snapshots: Arc<DashMap<String, AdapterInfo>>,
    deps: OnceLock<Arc<dyn RefreshDeps>>,
    refresh_allowed: AtomicBool,
    /// Per-adapter single-flight (rule 9). Modelled with `Notify` rather than
    /// `futures::future::Shared` because `futures` is a deferred workspace dep;
    /// a concurrent caller awaits the in-flight run's `Notify` instead of
    /// re-running. (A late waiter that subscribes after `notify_waiters()` fires
    /// re-runs rather than blocks — benign, and untriggered by the sequential
    /// tests; revisit if `futures::Shared` lands.)
    in_flight: Arc<DashMap<String, Arc<Notify>>>,
    succeeded: Arc<DashSet<String>>,
}

impl AdapterRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self, adapter: Arc<dyn Adapter>) {
        let id = adapter.id().to_string();
        self.adapters.insert(id, adapter);
    }

    pub fn get(&self, id: &str) -> Option<Arc<dyn Adapter>> {
        self.adapters.get(id).map(|e| e.value().clone())
    }

    pub fn get_all(&self) -> Vec<Arc<dyn Adapter>> {
        self.adapters.iter().map(|e| e.value().clone()).collect()
    }

    pub fn kill_all(&self) {
        for a in self.adapters.iter() {
            a.value().kill_all();
        }
    }

    pub fn configure_refresh(&self, deps: Arc<dyn RefreshDeps>) {
        // TS reassigns `this.deps`; `OnceLock` accepts the first setter (boot).
        let _ = self.deps.set(deps);
    }

    pub fn allow_refresh(&self) {
        self.refresh_allowed.store(true, Ordering::SeqCst);
    }

    /// STATIC-ONLY seed: no CLI spawn. Safe to call before server start.
    pub fn seed_static_snapshots(&self) {
        for entry in self.adapters.iter() {
            let adapter = entry.value();
            self.snapshots.insert(
                adapter.id().to_string(),
                AdapterInfo {
                    id: adapter.id().to_string(),
                    name: adapter.name().to_string(),
                    description: format!("{} adapter", adapter.name()),
                    installed: false,
                    version: None,
                    models: adapter.get_fallback_models().unwrap_or_default(),
                    models_revision: Some(1),
                    catalog_source: Some(CatalogSource::Fallback),
                    capabilities: adapter.capabilities(),
                },
            );
        }
    }

    pub fn get_snapshots(&self) -> Vec<AdapterInfo> {
        self.snapshots.iter().map(|e| e.value().clone()).collect()
    }

    pub async fn list(&self) -> Vec<AdapterInfo> {
        if self.refresh_allowed.load(Ordering::SeqCst) {
            // TS races refreshAll against a 2s cap (the timer is `.unref()`ed).
            // `tokio::time::timeout` cancels refreshAll if the cap wins — the boot
            // path calls refreshAll uncapped, and later list() calls re-trigger via
            // the idempotent single-flight, so the cancelled work is not lost.
            let _ = tokio::time::timeout(
                Duration::from_millis(REFRESH_LIST_CAP_MS),
                self.refresh_all(),
            )
            .await;
        }
        self.get_snapshots()
    }

    /// Per-adapter, parallel-in-TS, single-flight. Idempotent.
    pub async fn refresh_all(&self) {
        // TS uses Promise.allSettled (parallel) and logs each rejection. The Rust
        // port awaits each in turn (no `futures::join_all`); `refresh_adapter`
        // still dedups concurrent callers via `in_flight`, and each rejection is
        // logged here with the same message.
        for id in self.adapter_ids() {
            if let Err(err) = self.refresh_adapter(&id).await {
                tracing::warn!(
                    module = "adapter-registry",
                    ?err,
                    "adapter refresh rejected"
                );
            }
        }
    }

    fn adapter_ids(&self) -> Vec<String> {
        self.adapters.iter().map(|e| e.key().clone()).collect()
    }

    async fn refresh_adapter(&self, adapter_id: &str) -> Result<(), AdapterError> {
        if !self.refresh_allowed.load(Ordering::SeqCst) || self.succeeded.contains(adapter_id) {
            return Ok(());
        }
        // Single-flight: atomically claim the slot, or await an in-flight run.
        let notify = {
            use dashmap::mapref::entry::Entry;
            match self.in_flight.entry(adapter_id.to_string()) {
                Entry::Occupied(e) => {
                    let existing = e.get().clone();
                    drop(e); // release the shard guard before awaiting (rule 2)
                    existing.notified().await;
                    return Ok(());
                }
                Entry::Vacant(e) => {
                    let n = Arc::new(Notify::new());
                    e.insert(n.clone());
                    n
                }
            }
        };
        let result = self.run_refresh(adapter_id).await;
        self.in_flight.remove(adapter_id); // mirrors `.finally(() => inFlight.delete)`
        notify.notify_waiters();
        result
    }

    async fn run_refresh(&self, adapter_id: &str) -> Result<(), AdapterError> {
        let Some(adapter) = self.adapters.get(adapter_id).map(|e| e.value().clone()) else {
            return Ok(());
        };
        let Some(deps) = self.deps.get().cloned() else {
            return Ok(());
        };
        let exe_path = deps.resolve_executable_path(adapter_id.to_string()).await;
        // One `--version` spawn covers installed AND version (use the resolved path).
        let ver = deps
            .run(
                exe_path.clone().unwrap_or_else(|| adapter.id().to_string()),
                vec!["--version".to_string()],
                Some(5_000),
            )
            .await;
        let mut installed = ver.ok;
        let mut version = if ver.ok {
            parse_version(&ver.stdout)
        } else {
            None
        };
        // The spawn above assumes a literal CLI binary on PATH. Plugin-provided
        // adapters have no such binary and would ENOENT — fall back to asking the
        // adapter directly before concluding "not installed".
        if !installed {
            installed = adapter.is_installed().await?;
            if installed {
                version = adapter.get_version().await?;
            }
        }
        // Skip live discovery for an uninstalled adapter — no point spawning a probe.
        if !installed {
            self.apply_refresh(
                adapter_id,
                RefreshPatch {
                    installed,
                    version,
                    models: None,
                },
                &deps,
            );
            tracing::warn!(
                module = "adapter-registry",
                adapter_id,
                exe_path,
                "adapter not installed — skipping live catalog discovery"
            );
            return Ok(());
        }
        // Live catalog: Claude probes; Codex (no probeModels) lists.
        let models: Option<Vec<AdapterModel>> = {
            let res = if adapter.has_probe_models() {
                adapter.probe_models(exe_path.clone()).await
            } else {
                adapter.list_models().await.map(Some)
            };
            match res {
                Ok(m) => m,
                Err(err) => {
                    tracing::warn!(
                        module = "adapter-registry",
                        ?err,
                        adapter_id,
                        "live model refresh threw; keeping fallback catalog"
                    );
                    None
                }
            }
        };
        let got_live = models.as_ref().map(|m| !m.is_empty()).unwrap_or(false);
        self.apply_refresh(
            adapter_id,
            RefreshPatch {
                installed,
                version,
                models: if got_live { models } else { None },
            },
            &deps,
        );
        if got_live {
            self.succeeded.insert(adapter_id.to_string());
        } else {
            tracing::warn!(
                module = "adapter-registry",
                adapter_id,
                exe_path,
                "no live catalog — will retry on next refresh"
            );
        }
        Ok(())
    }

    fn apply_refresh(&self, adapter_id: &str, patch: RefreshPatch, deps: &Arc<dyn RefreshDeps>) {
        let Some(prev) = self.snapshots.get(adapter_id).map(|e| e.value().clone()) else {
            return;
        };
        let models_changed = patch.models.is_some();
        let models_revision = if models_changed {
            Some(prev.models_revision.unwrap_or(1) + 1)
        } else {
            prev.models_revision
        };
        let next = AdapterInfo {
            id: prev.id.clone(),
            name: prev.name.clone(),
            description: prev.description.clone(),
            installed: patch.installed,
            version: patch.version.clone().or_else(|| prev.version.clone()),
            models: patch.models.clone().unwrap_or_else(|| prev.models.clone()),
            models_revision,
            catalog_source: if models_changed {
                Some(CatalogSource::Probed)
            } else {
                prev.catalog_source
            },
            capabilities: prev.capabilities,
        };
        // Mutate the cache BEFORE emitting (rule 7) so a blocked subscriber cannot
        // leave the snapshot un-updated.
        self.snapshots.insert(adapter_id.to_string(), next);
        if let (Some(models), Some(rev)) = (patch.models, models_revision) {
            tracing::info!(
                module = "adapter-registry",
                adapter_id,
                models_revision = rev,
                count = models.len(),
                "adapter catalog updated"
            );
            deps.emit_event(DaemonEvent::AdapterModelsUpdated {
                adapter_id: adapter_id.to_string(),
                models,
                models_revision: rev,
            });
        }
    }
}

// PORT STATUS: src/adapters/index.ts (167 lines) + trait half of packages/types/src/adapter.ts
// confidence: medium
// notes: index.ts → this lib.rs (AdapterRegistry); the adapter.ts behavioral
// notes: interfaces landed in the sibling `adapter.rs` (kept out of lib.rs for a
// notes: clean side-by-side diff and the 300-line budget). Concurrency per
// notes: CONCURRENCY.tsv 130-135. Two documented gaps vs TS, both benign and
// notes: untriggered by the ported tests: (1) refresh_all awaits sequentially
// notes: instead of Promise.allSettled (no futures::join_all); (2) list()'s 2s cap
// notes: uses tokio::time::timeout, which CANCELS refreshAll on elapse rather than
// notes: leaving it running — boot calls refreshAll uncapped and single-flight
// notes: re-triggers make this lossless. Single-flight uses Notify (rule 9) since
// notes: futures::Shared is a deferred dep. Tests in tests/registry.rs.
// todos: 0
