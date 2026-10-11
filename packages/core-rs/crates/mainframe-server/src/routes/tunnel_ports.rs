//! Per-port quick tunnels for the localhost chips.
//!
//! Three endpoints under `/api/tunnel/ports`, driving `ctx.infra.port_tunnels`. Kept
//! out of `tunnel.rs`, which owns the single `daemon`-labelled remote-access
//! tunnel and its persisted config; these tunnels are ephemeral and per-chat.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::{get, post};
use mainframe_launch::{PortTunnelRegistry, PortTunnelScope};
use serde::Deserialize;
use serde_json::json;

use crate::ctx::AppCtx;
use crate::respond::{ApiError, fail, ok, ok_empty};
use crate::routes::body::parse_body;

/// Ports below 1024 are privileged and never a dev server; the client applies
/// the same floor in `isTunnelEligiblePort` (`@qlan-ro/mainframe-types`).
const MIN_PORT: u16 = 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartBody {
    port: u16,
    chat_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StopBody {
    port: u16,
}

async fn start(State(ctx): State<Arc<AppCtx>>, body: Bytes) -> Result<Response, ApiError> {
    let Some(registry) = available(&ctx) else {
        return Err(ApiError::BadRequest("Tunnel not available".into()));
    };
    let Some(body) = parse_body::<StartBody>(&body) else {
        return Err(ApiError::BadRequest("Invalid request body".into()));
    };
    if body.port < MIN_PORT {
        return Err(ApiError::BadRequest("Port must be 1024 or higher".into()));
    }
    if body.port == ctx.core.port {
        return Err(ApiError::BadRequest(
            "Cannot tunnel the daemon's own port".into(),
        ));
    }

    let project_id = ctx.require_chat(&body.chat_id).await?.project_id;

    let scope = PortTunnelScope {
        project_id,
        chat_id: body.chat_id,
    };
    match registry.start(body.port, scope).await {
        Ok(url) => Ok(ok(json!({ "url": url, "port": body.port }))),
        Err(error) => Err(ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            error.to_string(),
        )),
    }
}

async fn stop(State(ctx): State<Arc<AppCtx>>, body: Bytes) -> Response {
    let Some(registry) = available(&ctx) else {
        return fail(StatusCode::BAD_REQUEST, "Tunnel not available");
    };
    let Some(body) = parse_body::<StopBody>(&body) else {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    registry.stop(body.port).await;
    ok_empty()
}

async fn list(State(ctx): State<Arc<AppCtx>>) -> Response {
    let Some(registry) = available(&ctx) else {
        return fail(StatusCode::BAD_REQUEST, "Tunnel not available");
    };
    let tunnels: Vec<_> = registry
        .list()
        .into_iter()
        .map(|entry| {
            json!({
                "port": entry.port,
                "url": entry.url,
                "state": if entry.ready { "ready" } else { "starting" },
            })
        })
        .collect();
    ok(json!({ "tunnels": tunnels, "daemonPort": ctx.core.port }))
}

/// The registry plus a real listen port — `start` tunnels `http://localhost:{port}`
/// and every route reports `daemonPort`, both meaningless on the route-unit ctx.
fn available(ctx: &AppCtx) -> Option<&Arc<PortTunnelRegistry>> {
    (ctx.core.port != 0).then_some(&ctx.infra.port_tunnels)
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/tunnel/ports", get(list))
        .route("/api/tunnel/ports/start", post(start))
        .route("/api/tunnel/ports/stop", post(stop))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::response::IntoResponse;

    #[tokio::test]
    async fn unknown_chat_returns_404_without_starting_tunnel() {
        let mut ctx = AppCtx::test_ctx();
        let inner = Arc::get_mut(&mut ctx).unwrap();
        inner.core.port = 3210;
        inner.infra.port_tunnels = Arc::new(PortTunnelRegistry::new(Arc::new(
            mainframe_launch::TunnelManager::with_config(None, Default::default()),
        )));
        let response = start(
            State(ctx),
            Bytes::from(r#"{"port":8080,"chatId":"missing"}"#),
        )
        .await
        .into_response();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(
            bytes.as_ref(),
            br#"{"error":"Chat not found","success":false}"#
        );
    }
}
