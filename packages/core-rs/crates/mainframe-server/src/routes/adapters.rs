//! `GET /api/adapters`.
//!
//! `ctx.core.adapter_registry.list()` runs the registry's installed/version probing
//! (single-flight + 2s cap live in the registry itself) and returns the
//! `AdapterInfo` snapshots verbatim.

use std::sync::Arc;

use axum::Router;
use axum::extract::State;
use axum::response::Response;
use axum::routing::get;

use crate::ctx::AppCtx;
use crate::respond::ok;

async fn list(State(ctx): State<Arc<AppCtx>>) -> Response {
    let adapters_list = ctx.core.adapter_registry.list().await;
    ok(adapters_list)
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route("/api/adapters", get(list)).route(
        "/api/adapters/{adapter_id}/effective-model",
        get(super::adapter_model::resolve),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    use axum::body::to_bytes;
    use axum::http::StatusCode;

    #[tokio::test]
    async fn empty_registry_returns_success_empty_list() {
        let ctx = AppCtx::test_ctx();
        let resp = list(State(ctx)).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body, serde_json::json!({ "success": true, "data": [] }));
    }

    /// `noPersistence` is part of the wire capabilities of every adapter, not
    /// gated behind an adapter id check.
    #[tokio::test]
    async fn every_adapter_reports_no_persistence_capability() {
        let ctx = AppCtx::test_ctx();
        ctx.core
            .adapter_registry
            .register(Arc::new(mainframe_adapter_mock::MockCliAdapter::default()));
        ctx.core.adapter_registry.seed_static_snapshots();

        let resp = list(State(ctx)).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let adapters = body["data"].as_array().unwrap();
        assert_eq!(adapters.len(), 1);
        assert_eq!(adapters[0]["capabilities"]["noPersistence"], false);
    }
}
