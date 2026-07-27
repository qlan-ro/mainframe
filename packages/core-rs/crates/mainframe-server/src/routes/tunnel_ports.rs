//! Per-port quick tunnels for the localhost chips (#279).
//!
//! Three endpoints under `/api/tunnel/ports`, driving `ctx.port_tunnels`. Kept
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
use crate::respond::{fail, ok, ok_empty};
use crate::routes::projects::parse_body;

/// Ports below 1024 are privileged and never a dev server; the client applies
/// the same floor in `isTunnelEligiblePort`.
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

async fn start(State(ctx): State<Arc<AppCtx>>, body: Bytes) -> Response {
    let Some(registry) = available(&ctx) else {
        return fail(StatusCode::BAD_REQUEST, "Tunnel not available");
    };
    let Some(body) = parse_body::<StartBody>(&body) else {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    if body.port < MIN_PORT {
        return fail(StatusCode::BAD_REQUEST, "Port must be 1024 or higher");
    }
    if body.port == ctx.port {
        return fail(
            StatusCode::BAD_REQUEST,
            "Cannot tunnel the daemon's own port",
        );
    }

    let chat_id = body.chat_id.clone();
    let project_id = match ctx.db.call(move |db| db.chats.get(&chat_id)).await {
        Ok(Some(chat)) => chat.project_id,
        Ok(None) => return fail(StatusCode::BAD_REQUEST, "Chat not found"),
        Err(err) => return crate::async_err::internal_error("get chat", &err),
    };

    let scope = PortTunnelScope {
        project_id,
        chat_id: body.chat_id,
    };
    match registry.start(body.port, scope).await {
        Ok(url) => ok(json!({ "url": url, "port": body.port })),
        Err(error) => fail(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn stop(State(ctx): State<Arc<AppCtx>>, body: Bytes) -> Response {
    let Some(registry) = available(&ctx) else {
        return fail(StatusCode::BAD_REQUEST, "Tunnel not available");
    };
    let Some(body) = parse_body::<StopBody>(&body) else {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    registry.stop(body.port);
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
    ok(json!({ "tunnels": tunnels, "daemonPort": ctx.port }))
}

/// The registry plus a real listen port — `start` tunnels `http://localhost:{port}`
/// and every route reports `daemonPort`, both meaningless on the route-unit ctx.
fn available(ctx: &AppCtx) -> Option<&Arc<PortTunnelRegistry>> {
    ctx.port_tunnels.as_ref().filter(|_| ctx.port != 0)
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/tunnel/ports", get(list))
        .route("/api/tunnel/ports/start", post(start))
        .route("/api/tunnel/ports/stop", post(stop))
}
