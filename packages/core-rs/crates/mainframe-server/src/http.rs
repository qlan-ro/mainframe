//! Ported from `src/server/http.ts` — the axum app assembly.
//!
//! CORS (localhost-origin echo, `OPTIONS → 204`, `X-Content-Type-Options:
//! nosniff`), the 30mb JSON body limit, the auth middleware over the HTTP routes,
//! `GET /health`, the mounted Phase-3 route modules, and the WS upgrade route.

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::Request;
use axum::http::header::{
    ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS, ACCESS_CONTROL_ALLOW_ORIGIN, ORIGIN,
};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::middleware::{Next, from_fn, from_fn_with_state};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get};
use tower_http::limit::RequestBodyLimitLayer;

use crate::ctx::AppCtx;
use crate::middleware::auth::auth_middleware;
use crate::routes;
use crate::websocket::{lsp_ws_handler, ws_handler};

/// 30mb JSON body limit — matches `express.json({ limit: '30mb' })`.
const BODY_LIMIT_BYTES: usize = 30 * 1024 * 1024;

/// Builds the axum app. Mirrors `createHttpServer()`: the HTTP routes (health +
/// the Phase-3 route modules) sit behind the auth middleware; the WS upgrade at
/// `/` authenticates itself; CORS and the body limit wrap everything.
pub fn build_app(ctx: Arc<AppCtx>) -> Router {
    let mut http = Router::new()
        .route("/health", get(routes::health::get_health))
        .merge(routes::auth::router())
        .merge(routes::device::router())
        .merge(routes::projects::router())
        .merge(routes::tags::router())
        .merge(routes::settings::router())
        .merge(routes::commands::router())
        .merge(routes::files::router())
        .merge(routes::search::router())
        .merge(routes::git::router())
        .merge(routes::git_write::router())
        .merge(routes::git_chat::router())
        .merge(routes::attachments::router())
        // Phase-4 route modules (Task 4.6a). Chat lifecycle + orchestration
        // surfaces; the ChatManager-backed handlers self-gate on
        // `ctx.chat_manager` and fall back to the TS failure-path envelope while
        // the manager is unwired (its construction is a documented blocker).
        .merge(routes::chats::router())
        .merge(routes::chat_commands::router())
        .merge(routes::context::router())
        .merge(routes::worktree::router())
        .merge(routes::external_sessions::router())
        .merge(routes::background_tasks::router())
        .merge(routes::adapters::router())
        .merge(routes::agents::router())
        .merge(routes::skills::router())
        // Task 5.5 route modules: launch (per-project process control), tunnel
        // (cloudflared), and the LSP language-status endpoint.
        .merge(routes::launch::router())
        .merge(routes::tunnel::router())
        .merge(routes::lsp_routes::router());

    // Plugin routes — the PluginManager owns a parent router (listing + per-plugin
    // sub-routers) mounted under `/api/plugins`, behind the auth layer like the TS
    // `app.use('/api/plugins', pluginManager.router)`. Its state is already applied
    // (Router<()>), so it nests as a service.
    if let Some(plugin_manager) = ctx.plugin_manager.as_ref() {
        http = http.nest_service("/api/plugins", plugin_manager.router());
    }

    let http = http
        // Explicit 404 fallback so the auth layer also covers unmatched paths —
        // Express's `app.use(authMiddleware)` runs before the router's 404, so a
        // non-loopback caller without a token gets 401 (not 404) on any path.
        .fallback(not_found)
        .layer(from_fn_with_state(Arc::clone(&ctx), auth_middleware));

    Router::new()
        .merge(http)
        // WS upgrade — authenticates via the token query param (never the auth
        // layer, which reads the Authorization header).
        .route("/", any(ws_handler))
        // LSP WS upgrade (`/lsp/:projectId/:language`) — self-authenticates like
        // the generic WS route, then proxies to the spawned language server.
        .route("/lsp/{project_id}/{language}", any(lsp_ws_handler))
        .layer(RequestBodyLimitLayer::new(BODY_LIMIT_BYTES))
        // CORS is the outermost layer so `OPTIONS` is answered (204) before auth.
        .layer(from_fn(cors_middleware))
        .with_state(ctx)
}

/// Terminal 404. The route agents' handlers replace the empty stubs, but any
/// truly-unmatched path lands here (after auth, matching Express's ordering).
async fn not_found() -> Response {
    StatusCode::NOT_FOUND.into_response()
}

/// The `app.use((req,res,next) => …)` CORS block from `http.ts`: echoes a
/// localhost origin, sets the allow-methods/headers + `nosniff`, and answers
/// `OPTIONS` with a bare `204`.
async fn cors_middleware(req: Request, next: Next) -> Response {
    let origin = req
        .headers()
        .get(ORIGIN)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);

    if req.method() == Method::OPTIONS {
        let mut resp = (StatusCode::NO_CONTENT, Body::empty()).into_response();
        apply_cors_headers(resp.headers_mut(), origin.as_deref());
        return resp;
    }

    let mut resp = next.run(req).await;
    apply_cors_headers(resp.headers_mut(), origin.as_deref());
    resp
}

fn apply_cors_headers(headers: &mut HeaderMap, origin: Option<&str>) {
    if let Some(origin) = origin
        && is_localhost_origin(origin)
        && let Ok(value) = HeaderValue::from_str(origin)
    {
        headers.insert(ACCESS_CONTROL_ALLOW_ORIGIN, value);
    }
    headers.insert(
        ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, PUT, PATCH, DELETE, OPTIONS"),
    );
    headers.insert(
        ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Content-Type, Authorization"),
    );
    headers.insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
}

/// `^https?://(localhost|127\.0\.0\.1)(:\d+)?$` — the `LOCALHOST_ORIGIN` regex,
/// hand-matched (no `regex` crate in the allowlist).
fn is_localhost_origin(origin: &str) -> bool {
    let Some(rest) = origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))
    else {
        return false;
    };
    let (host, port) = match rest.split_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (rest, None),
    };
    if host != "localhost" && host != "127.0.0.1" {
        return false;
    }
    match port {
        None => true,
        Some(port) => !port.is_empty() && port.chars().all(|c| c.is_ascii_digit()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn localhost_origin_regex_parity() {
        assert!(is_localhost_origin("http://localhost"));
        assert!(is_localhost_origin("https://localhost:5173"));
        assert!(is_localhost_origin("http://127.0.0.1:31415"));
        assert!(!is_localhost_origin("http://evil.com"));
        assert!(!is_localhost_origin("http://localhost.evil.com"));
        assert!(!is_localhost_origin("http://localhost:notaport"));
        assert!(!is_localhost_origin("ftp://localhost"));
    }
}

// PORT STATUS: src/server/http.ts (createHttpServer)
// confidence: medium
// todos: 1
// notes: CORS ported as a from_fn middleware (not tower-http CorsLayer) for
// byte-exact parity: localhost-origin echo, OPTIONS→204, nosniff. Body limit via
// tower-http RequestBodyLimitLayer(30mb). Auth is a route_layer over the HTTP
// routes only; the WS `/` route self-authenticates. `trust proxy = loopback` is
// realized by net::client_ip (peer from ConnectInfo). TODO(port): the global
// thrown-error→500 envelope has no Rust analogue (handlers return Responses;
// unexpected errors map via async_err::internal_error); 404 is axum's default.
// Task 5.5 mounted the remaining surfaces: launch/tunnel/lsp route modules behind
// auth, the PluginManager router nested at /api/plugins (nest_service — its state is
// pre-applied), and the self-authenticating `/lsp/:projectId/:language` WS upgrade
// alongside the generic `/` WS route. Workflows stay deliberately unmounted
// (SCOPE DECISION 2026-07-10).
