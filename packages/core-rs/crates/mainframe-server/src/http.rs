//! Ported from `src/server/http.ts`.
//!
//! Scaffold: only the `GET /health` handler and its app-builder are ported.
//! Auth middleware, JSON body-parsing limits, and the remaining route
//! registrations are TODO(port) for Phase 3.

use axum::Router;
use std::sync::Arc;

use crate::routes::health;

/// Mirrors the mutable fields `http.ts`'s route closures read off `ctx`
/// (`ctx.tunnelUrl` / `getTunnelUrl?.()`) — narrowed to what `/health` needs.
#[derive(Debug, Clone)]
pub struct AppState {
    pub version: String,
    pub tunnel_url: Option<String>,
}

/// Builds the axum `Router`. Mirrors `createHttpServer()` in `src/server/http.ts`,
/// currently wired with only the `/health` route (see PORT STATUS below).
pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", axum::routing::get(health::get_health))
        .with_state(Arc::new(state))
}

// PORT STATUS: src/server/http.ts (GET /health only)
// confidence: medium
// todos: 1
// notes: express.json() body-limit, createAuthMiddleware, tunnel setter, and
// the rest of the route registrations are TODO(port) for Phase 3.
