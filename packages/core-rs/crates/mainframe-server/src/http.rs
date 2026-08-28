//! Ported from `src/server/http.ts` — the axum app assembly.
//!
//! CORS (localhost-origin echo, `OPTIONS → 204`, `X-Content-Type-Options:
//! nosniff`), the 30mb JSON body limit, the auth middleware over the HTTP routes,
//! negotiated gzip/brotli response compression (todo #294), `GET /health`, the
//! mounted Phase-3 route modules, and the WS upgrade route.

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Request};
use axum::http::header::{
    ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS, ACCESS_CONTROL_ALLOW_ORIGIN, ORIGIN,
};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::middleware::{Next, from_fn, from_fn_with_state};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get};
use tower_http::limit::RequestBodyLimitLayer;

use crate::acp_ws::acp_ws_handler;
use crate::cors_origin::is_allowed_origin;
use crate::ctx::AppCtx;
use crate::middleware::auth::auth_middleware;
use crate::middleware::compression::compression_layer;
use crate::routes;
use crate::websocket::{lsp_ws_handler, ws_handler};

/// 30mb JSON body limit — matches `express.json({ limit: '30mb' })`. Public so
/// integration tests can assert both edges of the limit against this value
/// instead of hardcoding it.
pub const BODY_LIMIT_BYTES: usize = 30 * 1024 * 1024;

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
        .merge(routes::git_remotes::router())
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
        .merge(routes::worktree_offer::router())
        .merge(routes::chat_recovery::router())
        .merge(routes::session_transcripts::router())
        .merge(routes::external_sessions::router())
        .merge(routes::background_tasks::router())
        .merge(routes::adapters::router())
        .merge(routes::agents::router())
        .merge(routes::skills::router())
        .merge(routes::skills_cli::router())
        .merge(routes::skills_registry::router())
        .merge(routes::suggestions::router())
        .merge(routes::setup_advisor::router())
        .merge(routes::quota::router())
        // Task 5.5 route modules: launch (per-project process control), tunnel
        // (cloudflared), and the LSP language-status endpoint.
        .merge(routes::launch::router())
        .merge(routes::tunnel::router())
        .merge(routes::tunnel_ports::router())
        .merge(routes::lsp_routes::router())
        // Automations v2 (T9.3). All behind auth EXCEPT the webhook ingress,
        // which middleware/auth.rs exempts by path (HMAC-verified instead).
        .merge(routes::automations::router())
        .merge(routes::automation_admin::router())
        .merge(routes::automation_credentials_github::router())
        .merge(routes::automation_webhook::router())
        // Standalone notifications for work launched outside a chat/run (e.g.
        // an ask_agent-spawned CLI session). Behind auth like everything
        // above, but loopback callers reach it with no token regardless
        // (middleware/auth.rs — loopback is never rejected).
        .merge(routes::notifications::router());

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
        .layer(from_fn_with_state(Arc::clone(&ctx), auth_middleware))
        // Outermost layer of the HTTP router only: the WS upgrades merged below
        // must never pass through the compressor.
        .layer(compression_layer());

    Router::new()
        .merge(http)
        // WS upgrade — authenticates via the token query param (never the auth
        // layer, which reads the Authorization header).
        .route("/", any(ws_handler))
        // LSP WS upgrade (`/lsp/:projectId/:language`) — self-authenticates like
        // the generic WS route, then proxies to the spawned language server.
        .route("/lsp/{project_id}/{language}", any(lsp_ws_handler))
        // ACP v2 chat-facade WS upgrade (todo #350) — self-authenticates like
        // the routes above; `{profile}` must name a registered adapter.
        .route("/acp/{profile}", any(acp_ws_handler))
        // axum's built-in 2 MB extractor limit shadows the layer below unless
        // disabled — without this, any body over ~2 MB (a ~1.5 MB attachment,
        // base64-inflated) gets an empty-bodied 413 before the handler runs.
        .layer(DefaultBodyLimit::disable())
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
        && is_allowed_origin(Some(origin))
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

// PORT STATUS: src/server/http.ts (createHttpServer)
// confidence: medium
// todos: 1
// notes: CORS ported as a from_fn middleware (not tower-http CorsLayer) for
// byte-exact parity: allowed-origin echo (via cors_origin::is_allowed_origin —
// widened for packaged Tauri per #411), OPTIONS→204, nosniff. Main catch-up
// (#424) mounts chat_recovery::router() after worktree. Body limit via
// tower-http RequestBodyLimitLayer(30mb). Auth is a route_layer over the HTTP
// routes only; the WS `/` route self-authenticates. `trust proxy = loopback` is
// realized by net::client_ip (peer from ConnectInfo). TODO(port): the global
// thrown-error→500 envelope has no Rust analogue (handlers return Responses;
// unexpected errors map via async_err::internal_error); 404 is axum's default.
// Task 5.5 mounted the remaining surfaces: launch/tunnel/lsp route modules behind
// auth, the PluginManager router nested at /api/plugins (nest_service — its state is
// pre-applied), and the self-authenticating `/lsp/:projectId/:language` WS upgrade
// alongside the generic `/` WS route. Workflows stay deliberately unmounted
// (SCOPE DECISION 2026-07-10). Negotiated gzip/brotli response compression
// (todo #294) is a Rust-side addition with no TS counterpart, layered inside
// the HTTP router so the WS upgrade routes stay untouched.
// #219: axum's own DefaultBodyLimit (2mb) sat inside RequestBodyLimitLayer's
// stack and rejected anything over ~2mb with an empty body before the 30mb
// layer ever ran — silently breaking 2-5mb attachments on every daemon, local
// or remote. Disabled so the explicit 30mb layer is the only limit in force.
