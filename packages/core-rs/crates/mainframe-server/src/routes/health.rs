//! `GET /health`.
//!
//! Bare-JSON response (not the `{success,data}` envelope). Wire contract: the UI
//! reads `version` from the top level of the body
//! (`packages/ui/src/features/daemon/pair-daemon.ts`). Always public (the auth
//! middleware skips it).

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
pub(crate) async fn get_health(State(ctx): State<Arc<AppCtx>>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        version: ctx.version.clone(),
        pid: std::process::id(),
        timestamp: mainframe_runtime::time::now_iso8601(),
        // The tunnel URL is interior-mutable, so this reflects the daemon-tunnel
        // boot start and the tunnel routes' `set_tunnel_url`.
        tunnel_url: ctx.tunnel_url(),
    })
}
