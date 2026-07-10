//! Ported from `src/server/routes/adapters.ts` — GET /api/adapters.
//!
//! Replaces the Phase-3 absence with the real handler: `ctx.adapter_registry.list()`
//! runs the registry's installed/version probing (single-flight + 2s cap live in
//! the registry itself) and returns the `AdapterInfo` snapshots verbatim.

use std::sync::Arc;

use axum::Router;
use axum::extract::State;
use axum::response::Response;
use axum::routing::get;

use crate::ctx::AppCtx;
use crate::respond::ok;

async fn list(State(ctx): State<Arc<AppCtx>>) -> Response {
    let adapters_list = ctx.adapter_registry.list().await;
    ok(adapters_list)
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route("/api/adapters", get(list))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ctx::{GitFactory, Services};
    use crate::db::Db;
    use axum::body::to_bytes;
    use axum::http::StatusCode;
    use dashmap::DashMap;
    use mainframe_db::DatabaseManager;
    use mainframe_services::attachment::AttachmentStore;
    use mainframe_services::files::FileWatcherService;
    use mainframe_services::push::PushService;
    use mainframe_types::events::DaemonEvent;
    use std::path::Path;

    fn test_ctx() -> Arc<AppCtx> {
        let db = Db::spawn(|| DatabaseManager::open(Path::new(":memory:"))).unwrap();
        let (broadcast, _keep) = tokio::sync::broadcast::channel::<DaemonEvent>(16);
        let watcher = FileWatcherService::new(|_| {});
        Arc::new(AppCtx {
            db,
            git: GitFactory,
            services: Services {
                attachments: Arc::new(AttachmentStore::new(
                    std::env::temp_dir().join("mf-adapters-test"),
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
            data_dir: std::env::temp_dir(),
            version: "0.0.0-test".into(),
            auth_secret: None,
            tunnel_url: None,
            ws_clients: Arc::new(DashMap::new()),
        })
    }

    #[tokio::test]
    async fn empty_registry_returns_success_empty_list() {
        let ctx = test_ctx();
        let resp = list(State(ctx)).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body, serde_json::json!({ "success": true, "data": [] }));
    }
}

// PORT STATUS: src/server/routes/adapters.ts (1 endpoint, 13 lines)
// confidence: high
// todos: 0
// notes: REPLACES the Phase-3 stub-limited absence. `ctx.adapters.list()` →
// `ctx.adapter_registry.list().await` (the registry owns installed/version probing
// + single-flight); response wrapped by `ok()`. Envelope `{success,data}` verified.
