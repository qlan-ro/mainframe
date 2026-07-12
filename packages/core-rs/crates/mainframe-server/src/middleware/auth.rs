//! Ported from `src/server/middleware/auth.ts`.
//!
//! Bearer-token gate with the loopback bypass. When `AUTH_TOKEN_SECRET` is unset
//! the middleware is a no-op. `/health` and the three unauthenticated auth paths
//! are always allowed. Loopback callers are never rejected — a token is validated
//! and attached (into request extensions, the axum analogue of `req.auth`) only
//! if present. Non-loopback callers must present a valid `Bearer <device token>`.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::{ConnectInfo, Request, State};
use axum::http::StatusCode;
use axum::http::header::AUTHORIZATION;
use axum::middleware::Next;
use axum::response::Response;
use mainframe_runtime::auth::{DeviceLookup, TokenPayload, validate_authed_token};
use mainframe_types::device::DeviceRow;

use crate::ctx::AppCtx;
use crate::db::Db;
use crate::net::{is_localhost, trust_proxy_client_ip};
use crate::respond::fail;

const UNAUTHENTICATED_PATHS: [&str; 3] = [
    "/api/auth/confirm",
    "/api/auth/status",
    "/api/auth/pair-status",
];

/// `POST /api/automation-webhooks/:hookId` is auth-exempt BY PATH (contract
/// §4 — external senders can't hold a device token; HMAC verifies them).
/// Exactly one non-empty segment after the prefix, so nothing else under
/// `/api/automation*` rides the exemption.
fn is_webhook_ingress(path: &str) -> bool {
    path.strip_prefix("/api/automation-webhooks/")
        .is_some_and(|rest| !rest.is_empty() && !rest.contains('/'))
}

/// Adapts a `&DevicesRepository` (fallible `find_by_device_id`) to the
/// `DeviceLookup` trait `validate_authed_token` consumes. A DB error fails
/// closed (`None`) — the TS `findByDeviceId` returns `DeviceRow | null` and the
/// caller never distinguishes "absent" from "errored".
struct RepoLookup<'a>(&'a mainframe_db::DevicesRepository);

impl DeviceLookup for RepoLookup<'_> {
    fn find_by_device_id(&self, device_id: &str) -> Option<DeviceRow> {
        self.0.find_by_device_id(device_id).ok().flatten()
    }
}

/// Validate `token` against the devices table on the DB thread, reusing
/// `validate_authed_token` verbatim. Shared with the WS upgrade path.
pub(crate) async fn validate_device_token(
    db: &Db,
    secret: String,
    token: String,
) -> Option<TokenPayload> {
    db.call(move |mgr| {
        Ok(validate_authed_token(
            &secret,
            &token,
            &RepoLookup(&mgr.devices),
        ))
    })
    .await
    .ok()
    .flatten()
}

fn bearer_token(req: &Request) -> Option<String> {
    let header = req.headers().get(AUTHORIZATION)?.to_str().ok()?;
    header.strip_prefix("Bearer ").map(str::to_string)
}

fn unauthorized() -> Response {
    fail(StatusCode::UNAUTHORIZED, "Unauthorized")
}

/// `createAuthMiddleware(secret, db.devices)` as an axum `from_fn_with_state`
/// layer over the HTTP routes (never the WS upgrade — that authenticates via the
/// token query param in `websocket.rs`).
pub async fn auth_middleware(
    State(ctx): State<Arc<AppCtx>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    mut req: Request,
    next: Next,
) -> Response {
    let Some(secret) = ctx.auth_secret.clone() else {
        return next.run(req).await;
    };

    let path = req.uri().path();
    if path == "/health" || UNAUTHENTICATED_PATHS.contains(&path) || is_webhook_ingress(path) {
        return next.run(req).await;
    }

    let forwarded = req
        .headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let ip = trust_proxy_client_ip(&peer.ip().to_string(), forwarded.as_deref());

    if is_localhost(&ip) {
        // Loopback: never rejected; attach `req.auth` only if a valid token rode along.
        if let Some(token) = bearer_token(&req)
            && let Some(payload) = validate_device_token(&ctx.db, secret, token).await
        {
            req.extensions_mut().insert(payload);
        }
        return next.run(req).await;
    }

    let Some(token) = bearer_token(&req) else {
        return unauthorized();
    };
    let Some(payload) = validate_device_token(&ctx.db, secret, token).await else {
        return unauthorized();
    };
    req.extensions_mut().insert(payload);
    next.run(req).await
}

// PORT STATUS: src/server/middleware/auth.ts (52 lines)
// confidence: high
// todos: 0
// notes: `req.auth = payload` → `req.extensions_mut().insert(TokenPayload)`.
// `req.ip` (Express trust-proxy=loopback) → `net::trust_proxy_client_ip(peer,
// x-forwarded-for)` (proxy-addr leftmost-untrusted, NOT the WS first-hop rule).
// The TS `!devicesRepo → 401` branch has no Rust analogue (a `Db` is always
// present); its behavior is subsumed — a valid signature for an absent device
// still yields `None` → 401 (covered by the deleted-device test). Secret read
// from `AppCtx.auth_secret` (the daemon reads `AUTH_TOKEN_SECRET` at boot), not
// `process.env` per-request.
