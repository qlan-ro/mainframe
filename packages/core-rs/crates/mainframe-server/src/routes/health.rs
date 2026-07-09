//! Ported from `GET /health` in `src/server/http.ts`.
//!
//! Bare-JSON response (not the `{success,data}` envelope) per
//! `docs/rust-port/CONTRACT/routes.json`'s `/health` entry, and always public
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
    pub timestamp: String,
    pub tunnel_url: Option<String>,
}

/// `GET /health`. Mirrors `app.get('/health', ...)` in `src/server/http.ts`.
pub async fn get_health(State(ctx): State<Arc<AppCtx>>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        version: ctx.version.clone(),
        timestamp: mainframe_runtime::time::now_iso8601(),
        // ctx.tunnelUrl ?? getTunnelUrl?.() ?? null — Phase 3 has no live tunnel,
        // so this is the boot value (None) until the Phase-4 tunnel routes set it.
        tunnel_url: ctx.tunnel_url.clone(),
    })
}

// PORT STATUS: src/server/http.ts (GET /health handler)
// confidence: high
// todos: 0
// notes: `tunnelUrl` serializes as `null` (not omitted) to match the fixture, so
// no `skip_serializing_if`. `timestamp` uses now_iso8601() (millis + `Z`, matching
// Node's Date.toISOString()), NOT chrono's to_rfc3339(). Byte shape verified in
// docs/rust-port/fixtures/route.health.json (the scaffold's assertions moved to
// the http integration tests).
