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
    for registration in quota_sources(adapters) {
        let source = registration.source;
        let adapter_id = registration.id;
        let mode = registration.mode;
        let identity = source.clone();
        quota.register_identity_resolver(
            &adapter_id,
            Arc::new(move || {
                let identity = identity.clone();
                Box::pin(async move { identity.identity().await })
            }),
        );
        let id = adapter_id.clone();
        let db = db.clone();
        let path = resolved_path.clone();
        quota.register_puller(
            &adapter_id,
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

pub(crate) struct QuotaRegistration {
    pub(crate) id: String,
    pub(crate) mode: IngestMode,
    pub(crate) poll: bool,
    source: Arc<dyn mainframe_adapter_api::QuotaSource>,
}

pub(crate) fn quota_sources(adapters: &AdapterRegistry) -> Vec<QuotaRegistration> {
    adapters
        .get_all()
        .into_iter()
        .filter_map(|adapter| {
            let source = adapter.quota_source()?;
            Some(QuotaRegistration {
                id: adapter.id().to_string(),
                mode: if source.merge_sparse() {
                    IngestMode::Push
                } else {
                    IngestMode::Pull
                },
                poll: source.poll(),
                source,
            })
        })
        .collect()
}
