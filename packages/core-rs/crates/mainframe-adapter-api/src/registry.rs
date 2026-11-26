//! [`AdapterRegistry`]: the daemon's adapters plus the `AdapterInfo` snapshot
//! each one advertises, refreshed from the installed CLI once refresh is
//! allowed at boot.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use dashmap::{DashMap, DashSet};
use mainframe_runtime::sync::SingleFlight;
use mainframe_types::adapter::{AdapterInfo, CatalogSource};
use mainframe_types::events::DaemonEvent;

use crate::resolve_executable::Runner;
use crate::{Adapter, BoxFuture};

mod refresh;

/// How long [`AdapterRegistry::list`] waits for a refresh before answering
/// with the snapshots it already has.
const LIST_REFRESH_CAP: Duration = Duration::from_secs(2);

/// What the registry's refresh needs from the daemon, set once with
/// [`AdapterRegistry::configure_refresh`]. Running `--version` goes through
/// the [`Runner`] supertrait.
pub trait RefreshDeps: Runner {
    fn resolve_executable_path(&self, adapter_id: String) -> BoxFuture<'_, Option<String>>;
    /// Emit a daemon event. The impl is a non-blocking channel send, so it
    /// cannot fail, and the snapshot is already updated before this call.
    fn emit_event(&self, event: DaemonEvent);
}

/// Registry of the daemon's adapters plus their materialized `AdapterInfo`
/// snapshots. The registry itself is shared as `Arc<AdapterRegistry>`.
#[derive(Default)]
pub struct AdapterRegistry {
    adapters: DashMap<String, Arc<dyn Adapter>>,
    snapshots: DashMap<String, AdapterInfo>,
    deps: OnceLock<Arc<dyn RefreshDeps>>,
    refresh_allowed: AtomicBool,
    /// When set, only these adapters are refreshed; the rest keep their
    /// static catalogs.
    refresh_ids: OnceLock<HashSet<String>>,
    /// Concurrent refreshes of one adapter share a cancellation-safe claim.
    in_flight: SingleFlight,
    /// Adapters whose live catalog has loaded; they are not refreshed again
    /// until [`AdapterRegistry::force_refresh`].
    succeeded: DashSet<String>,
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

    /// Attach the refresh dependencies. The first call (at boot) wins; later
    /// calls are ignored.
    pub fn configure_refresh(&self, deps: Arc<dyn RefreshDeps>) {
        if self.deps.set(deps).is_err() {
            tracing::debug!("adapter refresh deps already configured; keeping the first");
        }
    }

    pub fn allow_refresh(&self) {
        self.refresh_allowed.store(true, Ordering::SeqCst);
    }

    /// Allow refresh for `ids` only. The first allowlist wins.
    pub fn allow_refresh_for(&self, ids: impl IntoIterator<Item = String>) {
        if self.refresh_ids.set(ids.into_iter().collect()).is_err() {
            tracing::debug!("adapter refresh allowlist already set; keeping the first");
        }
        self.allow_refresh();
    }

    /// Seed every adapter's snapshot from its static catalog. Spawns nothing,
    /// so it is safe to call before the server starts.
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
                    models: adapter.catalog(),
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

    /// The snapshots, after giving a pending refresh up to
    /// [`LIST_REFRESH_CAP`] to land. A refresh cut off here is not lost: the
    /// boot path runs `refresh_all` uncapped, and the next call re-joins it
    /// through the single-flight claim.
    pub async fn list(&self) -> Vec<AdapterInfo> {
        if self.refresh_allowed.load(Ordering::SeqCst)
            && tokio::time::timeout(LIST_REFRESH_CAP, self.refresh_all())
                .await
                .is_err()
        {
            tracing::debug!("adapter refresh still running; listing current snapshots");
        }
        self.get_snapshots()
    }

    /// Refresh every adapter in turn. Idempotent: an adapter whose live
    /// catalog already loaded is skipped.
    pub async fn refresh_all(&self) {
        let ids: Vec<String> = self.adapters.iter().map(|e| e.key().clone()).collect();
        for id in ids {
            if let Err(err) = self.refresh_adapter(&id).await {
                tracing::warn!(adapter_id = id, error = %err, "adapter refresh failed");
            }
        }
    }

    /// Re-probe one adapter past the once-per-lifetime gate, after its CLI
    /// was updated in place: forget the cached catalog and the successful
    /// refresh, then run a fresh `--version` probe, capability recompute and
    /// live catalog request. A no-op until refresh is allowed at boot.
    pub async fn force_refresh(&self, adapter_id: &str) -> Result<(), crate::AdapterError> {
        let Some(adapter) = self.get(adapter_id) else {
            return Ok(());
        };
        adapter.invalidate_catalog();
        self.succeeded.remove(adapter_id);
        self.refresh_adapter(adapter_id).await
    }
}
