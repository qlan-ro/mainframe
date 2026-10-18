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
        quota.register_push_mode(&adapter_id, registration.push_mode);
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
        // Every puller harvests a full snapshot, so its result replaces.
        quota.register_puller(
            &adapter_id,
            IngestMode::Pull,
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
    pub(crate) push_mode: IngestMode,
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
                push_mode: if source.push_is_snapshot() {
                    IngestMode::Snapshot
                } else {
                    IngestMode::Push
                },
                poll: source.poll(),
                source,
            })
        })
        .collect()
}
