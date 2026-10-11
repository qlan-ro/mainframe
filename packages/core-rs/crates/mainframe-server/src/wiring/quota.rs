use super::refresh::resolve_adapter_path;
use crate::Db;
use mainframe_adapter_api::{AdapterError, AdapterRegistry};
use mainframe_services::quota::{IngestMode, QuotaManager};
use mainframe_types::seam_error::SeamError;
use std::sync::Arc;

pub(crate) fn register_quota_sources(
    quota: &Arc<QuotaManager>,
    adapters: &AdapterRegistry,
    db: &Db,
    resolved_path: &mainframe_runtime::ResolvedPath,
) {
    for adapter in adapters.get_all() {
        let Some(source) = adapter.quota_source() else {
            continue;
        };
        let mode = if source.merge_sparse() {
            IngestMode::Push
        } else {
            IngestMode::Pull
        };
        let identity = source.clone();
        quota.register_identity_resolver(
            adapter.id(),
            Arc::new(move || {
                let identity = identity.clone();
                Box::pin(async move { identity.identity().await })
            }),
        );
        let id = adapter.id().to_string();
        let db = db.clone();
        let path = resolved_path.clone();
        quota.register_puller(
            adapter.id(),
            mode,
            Arc::new(move || {
                let (source, id, db, path) = (source.clone(), id.clone(), db.clone(), path.clone());
                Box::pin(async move {
                    let binary = resolve_adapter_path(&db, &path, &id).await.ok_or_else(|| {
                        SeamError::new(AdapterError::Message(format!("{id} executable not found")))
                    })?;
                    source
                        .pull(binary, path.as_str().to_string())
                        .await
                        .map_err(SeamError::new)
                })
            }),
        );
    }
}
