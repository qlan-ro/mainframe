//! Ported from `src/server/routes/quota.ts` — provider quota read + manual refresh.
//!
//! The merged blob is account-wide (no chat scope); `okEmpty` means "no quota
//! known for this provider yet", not an error. `503` is reserved for the quota
//! service being unwired.

use std::sync::Arc;

use axum::Router;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::{get, post};

use crate::ctx::AppCtx;
use crate::respond::{fail, ok, ok_empty};

/// `QuotaProviderParams.id`: `^[a-zA-Z0-9_-]+$`.
fn is_valid_provider_id(s: &str) -> bool {
    !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
}

async fn get_quota(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    if !is_valid_provider_id(&id) {
        return fail(StatusCode::BAD_REQUEST, "invalid provider id");
    }
    match ctx.quota.as_ref().and_then(|q| q.get(&id)) {
        Some(quota) => ok(quota),
        None => ok_empty(),
    }
}

async fn refresh_quota(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    if !is_valid_provider_id(&id) {
        return fail(StatusCode::BAD_REQUEST, "invalid provider id");
    }
    let Some(quota) = ctx.quota.as_ref() else {
        return fail(StatusCode::SERVICE_UNAVAILABLE, "Quota service unavailable");
    };
    match quota.refresh(&id).await {
        Some(blob) => ok(blob),
        None => ok_empty(),
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/providers/{id}/quota", get(get_quota))
        .route("/api/providers/{id}/quota/refresh", post(refresh_quota))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ctx::{GitFactory, Services};
    use crate::db::Db;
    use axum::body::to_bytes;
    use dashmap::DashMap;
    use mainframe_db::DatabaseManager;
    use mainframe_services::attachment::AttachmentStore;
    use mainframe_services::files::FileWatcherService;
    use mainframe_services::push::PushService;
    use mainframe_services::quota::QuotaService;
    use mainframe_types::adapter::{ProviderQuota, ProviderQuotaStatus, QuotaWindow, QuotaWindowKind};
    use mainframe_types::events::DaemonEvent;
    use std::future::Future;
    use std::path::Path as FsPath;
    use std::pin::Pin;

    fn blob(used_percent: f64) -> ProviderQuota {
        ProviderQuota {
            status: ProviderQuotaStatus::Ok,
            observed_at: 1_700_000_000_000,
            model_windows: vec![],
            session: Some(QuotaWindow {
                kind: QuotaWindowKind::Session,
                used_percent,
                resets_at: Some(1_700_010_000_000),
                observed_at: None,
                label: None,
            }),
            weekly: None,
            account_identity: Some("uuid-1".into()),
        }
    }

    /// A duck-typed `{ get, refresh }` stand-in mirroring the TS test's mock.
    struct FakeQuota {
        get_result: Option<ProviderQuota>,
        refresh_result: Option<ProviderQuota>,
    }

    impl QuotaService for FakeQuota {
        fn get(&self, _adapter_id: &str) -> Option<ProviderQuota> {
            self.get_result.clone()
        }
        fn refresh<'a>(
            &'a self,
            _adapter_id: &'a str,
        ) -> Pin<Box<dyn Future<Output = Option<ProviderQuota>> + Send + 'a>> {
            let out = self.refresh_result.clone();
            Box::pin(async move { out })
        }
    }

    fn test_ctx(quota: Option<Arc<dyn QuotaService>>) -> Arc<AppCtx> {
        let db = Db::spawn(|| DatabaseManager::open(FsPath::new(":memory:"))).unwrap();
        let (broadcast, _keep) = tokio::sync::broadcast::channel::<DaemonEvent>(16);
        std::mem::forget(_keep);
        let watcher = FileWatcherService::new(|_| {});
        Arc::new(AppCtx {
            db,
            git: GitFactory,
            services: Services {
                attachments: Arc::new(AttachmentStore::new(
                    std::env::temp_dir().join("mf-quota-test"),
                )),
                push: Arc::new(PushService::new()),
                watcher: Arc::new(watcher),
            },
            broadcast,
            adapter_registry: Arc::new(mainframe_adapter_api::AdapterRegistry::new()),
            background_tasks: Arc::new(
                mainframe_background_tasks::tracker::BackgroundTaskTracker::new(),
            ),
            chat_manager: None,
            launch_registry: None,
            tunnel_manager: None,
            lsp_manager: None,
            plugin_manager: None,
            automations: None,
            quota,
            data_dir: std::env::temp_dir(),
            version: "0.0.0-test".into(),
            port: 0,
            auth_secret: None,
            resolved_path: mainframe_runtime::ResolvedPath::from_value("/usr/bin:/bin"),
            tunnel_url: Arc::new(std::sync::RwLock::new(None)),
            ws_clients: Arc::new(DashMap::new()),
        })
    }

    async fn body_json(resp: Response) -> (StatusCode, serde_json::Value) {
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[tokio::test]
    async fn get_returns_the_merged_blob_in_the_ok_envelope() {
        let quota: Arc<dyn QuotaService> = Arc::new(FakeQuota {
            get_result: Some(blob(42.0)),
            refresh_result: None,
        });
        let ctx = test_ctx(Some(quota));
        let (status, body) = body_json(get_quota(State(ctx), Path("claude".into())).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["success"], serde_json::json!(true));
        assert_eq!(body["data"]["session"]["usedPercent"], serde_json::json!(42.0));
    }

    #[tokio::test]
    async fn get_returns_empty_envelope_when_no_quota_is_known() {
        let quota: Arc<dyn QuotaService> = Arc::new(FakeQuota {
            get_result: None,
            refresh_result: None,
        });
        let ctx = test_ctx(Some(quota));
        let (status, body) = body_json(get_quota(State(ctx), Path("claude".into())).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, serde_json::json!({ "success": true }));
    }

    #[tokio::test]
    async fn get_rejects_an_id_with_illegal_characters() {
        let quota: Arc<dyn QuotaService> = Arc::new(FakeQuota {
            get_result: None,
            refresh_result: None,
        });
        let ctx = test_ctx(Some(quota));
        // Axum has already percent-decoded `cla%20ude` into `cla ude` by here.
        let (status, body) = body_json(get_quota(State(ctx), Path("cla ude".into())).await).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["success"], serde_json::json!(false));
    }

    #[tokio::test]
    async fn refresh_returns_the_updated_blob() {
        let quota: Arc<dyn QuotaService> = Arc::new(FakeQuota {
            get_result: None,
            refresh_result: Some(blob(77.0)),
        });
        let ctx = test_ctx(Some(quota));
        let (status, body) =
            body_json(refresh_quota(State(ctx), Path("claude".into())).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["data"]["session"]["usedPercent"], serde_json::json!(77.0));
    }

    #[tokio::test]
    async fn refresh_returns_empty_envelope_when_it_yields_no_blob() {
        let quota: Arc<dyn QuotaService> = Arc::new(FakeQuota {
            get_result: None,
            refresh_result: None,
        });
        let ctx = test_ctx(Some(quota));
        let (status, body) =
            body_json(refresh_quota(State(ctx), Path("codex".into())).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, serde_json::json!({ "success": true }));
    }

    #[tokio::test]
    async fn refresh_503s_when_the_quota_service_is_unavailable() {
        let ctx = test_ctx(None);
        let (status, body) =
            body_json(refresh_quota(State(ctx), Path("claude".into())).await).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body["success"], serde_json::json!(false));
    }
}

// PORT STATUS: src/server/routes/quota.ts (2 endpoints)
// confidence: high
// todos: 0
// notes: GET reads ctx.quota.get(id) → ok(blob) / okEmpty; POST refresh awaits
// ctx.quota.refresh(id) → ok(blob) / okEmpty, 503 when quota is unwired. id
// validated against QuotaProviderParams `^[a-zA-Z0-9_-]+$` ("invalid provider id").
// ctx.quota is Option<Arc<dyn QuotaService>> so the route-unit harness injects a
// FakeQuota, mirroring the TS `{ get, refresh }` mock.
