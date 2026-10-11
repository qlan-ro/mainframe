use super::*;

pub(super) async fn probe_installation(
    adapter: &Arc<dyn Adapter>,
    deps: &Arc<dyn RefreshDeps>,
    exe_path: &Option<String>,
) -> Result<(bool, Option<String>), AdapterError> {
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
        crate::version::CliVersion::parse(&ver.stdout).map(|v| v.to_string())
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
    Ok((installed, version))
}

pub(super) async fn refresh_catalog(
    adapter: &Arc<dyn Adapter>,
    adapter_id: &str,
    exe_path: Option<String>,
) -> Option<Vec<AdapterModel>> {
    // A failed refresh leaves the previous catalog intact.
    let models: Option<Vec<AdapterModel>> = {
        let res = adapter.refresh_catalog(exe_path.clone()).await;
        match res {
            Ok(m) => m,
            Err(err) => {
                tracing::warn!(error = ?err,
                    adapter_id,
                    "live model refresh threw; keeping fallback catalog"
                );
                None
            }
        }
    };
    models
}

pub(super) fn refresh_snapshot(
    prev: &AdapterInfo,
    patch: &RefreshPatch,
    adapter: Option<&Arc<dyn Adapter>>,
) -> AdapterInfo {
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

    AdapterInfo {
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
    }
}
