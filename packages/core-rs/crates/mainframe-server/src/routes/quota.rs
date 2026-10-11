use std::sync::Arc;

use axum::Router;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::{get, post};

use crate::ctx::AppCtx;
use crate::respond::{fail, ok, ok_empty};

async fn get_quota(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    if !mainframe_types::ids::is_safe_identifier(&id) {
        return fail(StatusCode::BAD_REQUEST, "invalid provider id");
    }
    match ctx.services.quota.get(&id) {
        Some(quota) => ok(quota),
        None => ok_empty(),
    }
}

async fn refresh_quota(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    if !mainframe_types::ids::is_safe_identifier(&id) {
        return fail(StatusCode::BAD_REQUEST, "invalid provider id");
    }
    let quota = &ctx.services.quota;
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
#[path = "quota_tests.rs"]
mod tests;
