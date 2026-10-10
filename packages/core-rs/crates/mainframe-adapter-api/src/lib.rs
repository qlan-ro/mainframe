//! `mainframe-adapter-api` — the adapter contract crate.
//!
//! - `adapter` holds the behavioral half of the adapter contract (the
//!   `Adapter` / `AdapterSession` / `SessionSink` traits). The data half lives
//!   in `mainframe-types::adapter`.
//! - this `lib.rs` holds the `AdapterRegistry`, plus the shared support types
//!   (`BoxFuture`, `RunResult`, `AdapterError`) and the `RefreshDeps` injection
//!   trait.
//! - `resolve_executable` resolves and persists each adapter's CLI executable path.
//!
//! The `AdapterRegistry` tests live in `tests/registry.rs` (they exercise only
//! the public surface) so this file stays focused on the registry.
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
pub mod pr_detection;
pub mod resolve_executable;
pub mod title;

pub use adapter::{
    Adapter, AdapterSession, ContextFiles, FORK_CUT_NOT_FOUND_REASON, ForkCut, ForkPinError,
    ForkPinRequest, ImageInput, LoadedSkill, SessionSink, StopBackgroundTaskResult,
};
pub use plan_mode_actions::{
    PlanActionContext, PlanChatUpdate, PlanModeActionHandler, clear_context_and_restart,
};
pub use title::finalize_title;
// The control envelopes are DATA (they live in mainframe-types); re-exported here
// so adapter consumers get them from the contract crate.
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
/// crate in the allowlist).
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

/// Injected refresh dependencies, set once via `configure_refresh`.
pub trait RefreshDeps: Send + Sync {
    fn resolve_executable_path(&self, adapter_id: String) -> BoxFuture<'_, Option<String>>;
    fn run(
        &self,
        cmd: String,
        args: Vec<String>,
        timeout_ms: Option<u64>,
    ) -> BoxFuture<'_, RunResult>;
    /// Emit a daemon event. The impl is a non-blocking channel send, so it
    /// cannot fail, and the snapshot is already updated before this call.
    fn emit_event(&self, event: DaemonEvent);
}

struct RefreshPatch {
    installed: bool,
    version: Option<String>,
    models: Option<Vec<AdapterModel>>,
}

/// Registry of the daemon's adapters plus their materialized `AdapterInfo`
/// snapshots. The registry itself is shared as `Arc<AdapterRegistry>`.
#[derive(Default)]
pub struct AdapterRegistry {
    adapters: Arc<DashMap<String, Arc<dyn Adapter>>>,
    snapshots: Arc<DashMap<String, AdapterInfo>>,
    deps: OnceLock<Arc<dyn RefreshDeps>>,
    refresh_allowed: AtomicBool,
    /// Per-adapter single-flight. Modelled with `Notify` rather than
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
        // `OnceLock` accepts the first setter (boot); later calls are ignored.
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
                    fork_unavailable_reason: adapter.fork_unavailable_reason(),
                },
            );
        }
    }

    pub fn get_snapshots(&self) -> Vec<AdapterInfo> {
        self.snapshots.iter().map(|e| e.value().clone()).collect()
    }

    pub async fn list(&self) -> Vec<AdapterInfo> {
        if self.refresh_allowed.load(Ordering::SeqCst) {
            // Race refresh_all against a 2s cap: `tokio::time::timeout` cancels it
            // if the cap wins — the boot path calls refresh_all uncapped, and later
            // list() calls re-trigger via the idempotent single-flight, so the
            // cancelled work is not lost.
            let _ = tokio::time::timeout(
                Duration::from_millis(REFRESH_LIST_CAP_MS),
                self.refresh_all(),
            )
            .await;
        }
        self.get_snapshots()
    }

    /// Per-adapter, single-flight. Idempotent.
    pub async fn refresh_all(&self) {
        // Awaits each adapter in turn (no `futures::join_all`); `refresh_adapter`
        // still dedups concurrent callers via `in_flight`, and each rejection is
        // logged here.
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
                    drop(e); // release the shard guard before awaiting
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
        // In E2E the only adapters whose live state matters are the mock replay
        // CLIs: the default `mock-cli` and, when the provider-switch harness
        // registers a second identity for switching between two mocks
        // (`mainframe-daemon/src/e2e_mock.rs::SECOND_MOCK_ID`), `mock-cli-b`.
        // This crate sits below `mainframe-daemon` and cannot import that
        // constant, so the match is by prefix; probing claude/codex here costs
        // a `--version` spawn plus a model-catalog spawn each (~1s a piece when
        // those CLIs are actually installed on the dev machine), and
        // `/api/adapters` blocks on this refresh — a cost the harness pays on
        // every describe's daemon boot (100+ a run). Skip the real adapters and
        // leave them on their seeded fallback snapshot.
        if !adapter_id.starts_with("mock-cli") && std::env::var_os("E2E_MODE").is_some() {
            return Ok(());
        }
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
        // Report the version once, however it was determined (primary `--version`
        // spawn or the fallback path above), before either `apply_refresh` call
        // site below recomputes `capabilities()` — a version-gated capability
        // (Codex's `fork`) reads this synchronously from `capabilities()`
        // and must see it before the snapshot is rebuilt.
        adapter.observe_cli_version(version.as_deref());
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
        let adapter = self.adapters.get(adapter_id).map(|e| e.value().clone());
        let installed = patch.installed;
        let models_changed = patch.models.is_some();
        let models_revision = if models_changed {
            Some(prev.models_revision.unwrap_or(1) + 1)
        } else {
            prev.models_revision
        };
        // Recomputed from the adapter every refresh: a
        // version-gated capability (Codex's `fork`) can flip after
        // `observe_cli_version` ran, with no catalog change at all. Missing
        // adapter (shouldn't happen — `prev` came from this same registry)
        // keeps whatever the snapshot already had.
        let capabilities = adapter
            .as_ref()
            .map(|a| a.capabilities())
            .unwrap_or(prev.capabilities);
        let fork_unavailable_reason = adapter.as_ref().and_then(|a| a.fork_unavailable_reason());
        let capabilities_changed = capabilities != prev.capabilities;
        let reason_changed = fork_unavailable_reason != prev.fork_unavailable_reason;
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
            capabilities,
            fork_unavailable_reason,
        };
        // Mutate the cache BEFORE emitting so a blocked subscriber cannot
        // leave the snapshot un-updated.
        self.snapshots.insert(adapter_id.to_string(), next.clone());
        if let (Some(models), Some(rev)) = (&patch.models, models_revision) {
            tracing::info!(
                module = "adapter-registry",
                adapter_id,
                models_revision = rev,
                count = models.len(),
                "adapter catalog updated"
            );
        }
        // Emit whenever anything a client might act on changed — not just the
        // catalog — so a capability/reason flip with no model change (Codex's
        // fork gate) still reaches an open websocket.
        if models_changed || capabilities_changed || reason_changed {
            deps.emit_event(DaemonEvent::AdapterModelsUpdated {
                adapter_id: adapter_id.to_string(),
                models: next.models,
                models_revision: next.models_revision.unwrap_or(1),
                installed: Some(installed),
                capabilities: Some(next.capabilities),
                fork_unavailable_reason: next.fork_unavailable_reason,
            });
        }
    }
}
