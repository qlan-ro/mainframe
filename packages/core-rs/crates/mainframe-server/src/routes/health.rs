//! Ported from `GET /health` in `src/server/http.ts`.
//!
//! Bare-JSON response (not the `{success,data}` envelope) per
//! the frozen wire-contract snapshot from the Node daemon (retired — see git history around the 2026-07-24 Rust cutover) `/health` entry, and always public
//! (the auth middleware skips it).

use std::sync::Arc;

use axum::extract::State;
use axum::response::Json;
use serde::Serialize;

use crate::ctx::AppCtx;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub status: &'static str,
    pub version: String,
    /// Identifies which process owns the port when diagnosing a stale/orphaned
    /// daemon (version + pid answer "who is serving me" with one curl).
    pub pid: u32,
    pub timestamp: String,
    pub tunnel_url: Option<String>,
}

/// `GET /health`. Mirrors `app.get('/health', ...)` in `src/server/http.ts`.
pub async fn get_health(State(ctx): State<Arc<AppCtx>>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        version: ctx.version.clone(),
        pid: std::process::id(),
        timestamp: mainframe_runtime::time::now_iso8601(),
        // ctx.tunnelUrl ?? getTunnelUrl?.() ?? null — interior-mutable, so this
        // reflects the daemon-tunnel boot start and the tunnel routes' setTunnelUrl.
        tunnel_url: ctx.tunnel_url(),
    })
}
