//! One adapter's refresh: probe the installed CLI, recompute capabilities,
//! ask for the live catalog, and publish the new snapshot.

use std::sync::atomic::Ordering;

use mainframe_types::adapter::{AdapterInfo, AdapterModel, CatalogSource};
use mainframe_types::events::DaemonEvent;

use super::{AdapterRegistry, RefreshDeps};
use crate::version::{CliVersion, VERSION_PROBE_TIMEOUT};
use crate::{Adapter, AdapterError};

/// What one refresh learned about an adapter. `models` is `None` when no live
/// catalog arrived, so the snapshot keeps the catalog it had.
struct RefreshPatch {
    installed: bool,
    version: Option<String>,
    models: Option<Vec<AdapterModel>>,
}

impl AdapterRegistry {
    pub(super) async fn refresh_adapter(&self, adapter_id: &str) -> Result<(), AdapterError> {
        if !self.refresh_allowed.load(Ordering::SeqCst) || self.succeeded.contains(adapter_id) {
            return Ok(());
        }
        match self.in_flight.claim(adapter_id) {
            Ok(_claim) => self.run_refresh(adapter_id).await,
            Err(waiter) => {
                waiter.wait().await;
                Ok(())
            }
        }
    }

    async fn run_refresh(&self, adapter_id: &str) -> Result<(), AdapterError> {
        let Some(adapter) = self.get(adapter_id) else {
            return Ok(());
        };
        let Some(deps) = self.deps.get().cloned() else {
            return Ok(());
        };
        if self
            .refresh_ids
            .get()
            .is_some_and(|ids| !ids.contains(adapter_id))
        {
            return Ok(());
        }
        let exe_path = deps.resolve_executable_path(adapter_id.to_string()).await;
        let (installed, version) =
            probe_installation(adapter.as_ref(), deps.as_ref(), exe_path.as_deref()).await?;
        // Before the snapshot is rebuilt: a version-gated capability (Codex's
        // `fork`) reads the observed version synchronously in `capabilities()`.
        adapter.observe_cli_version(version.as_deref());
        let models = if installed {
            live_catalog(adapter.as_ref(), exe_path.clone())
                .await
                .filter(|models| !models.is_empty())
        } else {
            None
        };
        let got_live = models.is_some();
        let patch = RefreshPatch {
            installed,
            version,
            models,
        };
        self.apply_refresh(adapter.as_ref(), patch, deps.as_ref());
        if got_live {
            self.succeeded.insert(adapter_id.to_string());
        } else if installed {
            tracing::warn!(
                adapter_id,
                exe_path,
                "no live catalog; will retry on next refresh"
            );
        } else {
            tracing::warn!(
                adapter_id,
                exe_path,
                "adapter not installed; skipped live catalog"
            );
        }
        Ok(())
    }

    fn apply_refresh(&self, adapter: &dyn Adapter, patch: RefreshPatch, deps: &dyn RefreshDeps) {
        let adapter_id = adapter.id();
        let Some(prev) = self.snapshots.get(adapter_id).map(|e| e.value().clone()) else {
            return;
        };
        let next = refreshed_snapshot(&prev, patch, adapter);
        let models_changed = next.models_revision != prev.models_revision;
        // Anything a client might act on: the catalog, whether the CLI is
        // installed, or a capability flip with no model change (Codex's fork
        // gate) must all reach an open websocket.
        let changed = models_changed
            || next.installed != prev.installed
            || next.capabilities != prev.capabilities
            || next.fork_unavailable_reason != prev.fork_unavailable_reason;
        // Update the cache before emitting so a blocked subscriber cannot
        // leave the snapshot stale.
        self.snapshots.insert(adapter_id.to_string(), next.clone());
        if models_changed {
            tracing::info!(
                adapter_id,
                models_revision = next.models_revision,
                count = next.models.len(),
                "adapter catalog updated"
            );
        }
        if changed {
            deps.emit_event(DaemonEvent::AdapterModelsUpdated {
                adapter_id: adapter_id.to_string(),
                models: next.models,
                models_revision: next.models_revision.unwrap_or(1),
                installed: Some(next.installed),
                capabilities: Some(next.capabilities),
                fork_unavailable_reason: next.fork_unavailable_reason,
            });
        }
    }
}

/// `(installed, version)` from one `--version` spawn of the resolved path.
/// Plugin-provided adapters have no CLI binary on `PATH`, so a failed spawn
/// falls back to asking the adapter itself.
async fn probe_installation(
    adapter: &dyn Adapter,
    deps: &dyn RefreshDeps,
    exe_path: Option<&str>,
) -> Result<(bool, Option<String>), AdapterError> {
    let probe = deps
        .run(
            exe_path.unwrap_or(adapter.id()).to_string(),
            vec!["--version".to_string()],
            VERSION_PROBE_TIMEOUT,
        )
        .await;
    if probe.ok {
        let version = CliVersion::parse(&probe.stdout).map(|v| v.to_string());
        return Ok((true, version));
    }
    if !adapter.is_installed().await? {
        return Ok((false, None));
    }
    Ok((true, adapter.get_version().await?))
}

/// The adapter's live catalog, or `None` when it has none or the request
/// failed; a failed refresh keeps the previous catalog.
async fn live_catalog(
    adapter: &dyn Adapter,
    exe_path: Option<String>,
) -> Option<Vec<AdapterModel>> {
    match adapter.refresh_catalog(exe_path).await {
        Ok(models) => models,
        Err(err) => {
            tracing::warn!(
                adapter_id = adapter.id(),
                error = %err,
                "live model refresh failed; keeping the current catalog"
            );
            None
        }
    }
}

fn refreshed_snapshot(
    prev: &AdapterInfo,
    patch: RefreshPatch,
    adapter: &dyn Adapter,
) -> AdapterInfo {
    let RefreshPatch {
        installed,
        version,
        models,
    } = patch;
    let models_changed = models.is_some();
    AdapterInfo {
        id: prev.id.clone(),
        name: prev.name.clone(),
        description: prev.description.clone(),
        installed,
        version: version.or_else(|| prev.version.clone()),
        models: models.unwrap_or_else(|| prev.models.clone()),
        models_revision: if models_changed {
            Some(prev.models_revision.unwrap_or(1) + 1)
        } else {
            prev.models_revision
        },
        catalog_source: if models_changed {
            Some(CatalogSource::Probed)
        } else {
            prev.catalog_source
        },
        // Recomputed every refresh: a version-gated capability can flip after
        // `observe_cli_version` with no catalog change at all.
        capabilities: adapter.capabilities(),
        fork_unavailable_reason: adapter.fork_unavailable_reason(),
    }
}
