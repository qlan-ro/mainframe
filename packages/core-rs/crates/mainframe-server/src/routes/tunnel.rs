//! Ported from `src/server/routes/tunnel.ts` — the cloudflared tunnel routes.
//!
//! Four endpoints under `/api/tunnel`: `status`, `config`, `start`, `stop`. `start`
//! and `stop` drive `ctx.tunnel_manager`, update the `/health` tunnel URL via
//! `set_tunnel_url`, and persist the tunnel config through `save_config`.

use std::sync::Arc;

use axum::Json;
use axum::Router;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::{get, post};
use mainframe_runtime::config::{PartialMainframeConfig, get_config, save_config};
use serde_json::{Value, json};

use crate::ctx::AppCtx;
use crate::respond::{fail, ok, ok_empty};

async fn get_status(State(ctx): State<Arc<AppCtx>>) -> Response {
    let url = ctx
        .tunnel_manager
        .as_ref()
        .and_then(|t| t.get_url("daemon"));
    let verified = match (&url, ctx.tunnel_manager.as_ref()) {
        (Some(_), Some(manager)) => manager.verify("daemon").await,
        _ => false,
    };
    ok(json!({ "running": url.is_some(), "url": url, "verified": verified }))
}

async fn get_config_route() -> Response {
    let config = match get_config() {
        Ok(config) => config,
        Err(err) => {
            tracing::warn!(%err, "tunnel config read failed");
            return ok(json!({ "hasToken": false, "url": Value::Null }));
        }
    };
    ok(json!({
        "hasToken": config.tunnel_token.is_some(),
        "url": config.tunnel_url,
    }))
}

async fn start(State(ctx): State<Arc<AppCtx>>, body: Option<Json<Value>>) -> Response {
    let (Some(manager), true) = (ctx.tunnel_manager.as_ref(), ctx.port != 0) else {
        return fail(StatusCode::BAD_REQUEST, "Tunnel not available");
    };

    let body = body.map(|Json(v)| v).unwrap_or_else(|| json!({}));
    let (body_token, body_url) = match parse_start_body(&body) {
        Ok(pair) => pair,
        Err(error) => return fail(StatusCode::BAD_REQUEST, error),
    };

    // Fall back to the persisted config when the renderer omits a token — this
    // happens when the user clicks "Start" on an already-configured named tunnel.
    let cfg = get_config().ok();
    let token = body_token
        .clone()
        .or_else(|| cfg.as_ref().and_then(|c| c.tunnel_token.clone()));
    let named_url = body_url
        .clone()
        .or_else(|| cfg.as_ref().and_then(|c| c.tunnel_url.clone()));

    if let Some(existing) = manager.get_url("daemon")
        && body_token.is_none()
    {
        return ok(json!({ "url": existing }));
    }

    let options = token.map(|token| mainframe_launch::TunnelStartOptions {
        token: Some(token),
        url: named_url,
    });
    match manager.start(ctx.port, "daemon", options).await {
        Ok(url) => {
            ctx.set_tunnel_url(Some(url.clone()));
            // Only persist new credentials when the caller explicitly provided them.
            let partial = if let (Some(token), Some(url)) = (&body_token, &body_url) {
                PartialMainframeConfig {
                    tunnel: Some(true),
                    tunnel_token: Some(token.clone()),
                    tunnel_url: Some(url.clone()),
                    ..PartialMainframeConfig::default()
                }
            } else {
                PartialMainframeConfig {
                    tunnel: Some(true),
                    ..PartialMainframeConfig::default()
                }
            };
            if let Err(err) = save_config(partial) {
                tracing::warn!(%err, "tunnel start: save_config failed");
            }
            ok(json!({ "url": url }))
        }
        Err(message) => fail(StatusCode::INTERNAL_SERVER_ERROR, message),
    }
}

async fn stop(State(ctx): State<Arc<AppCtx>>, body: Option<Json<Value>>) -> Response {
    let Some(manager) = ctx.tunnel_manager.as_ref() else {
        return fail(StatusCode::BAD_REQUEST, "Tunnel not available");
    };
    let body = body.map(|Json(v)| v).unwrap_or_else(|| json!({}));
    let clear_config = match parse_stop_body(&body) {
        Ok(clear) => clear,
        Err(error) => return fail(StatusCode::BAD_REQUEST, error),
    };

    manager.stop("daemon");
    ctx.set_tunnel_url(None);

    // TODO(port): the TS clears the persisted token/url on clearConfig
    // (`saveConfig({ tunnel: false, tunnelToken: undefined, tunnelUrl: undefined })`).
    // The ported `save_config` merges a `PartialMainframeConfig` where `None` means
    // "leave unchanged", so it cannot force-clear a field without a change to the
    // (done, off-limits) `mainframe-runtime::config`. The tunnel is still disabled
    // (`tunnel: false`), but stale credentials persist. Flagged as a blocker.
    let partial = PartialMainframeConfig {
        tunnel: Some(false),
        ..PartialMainframeConfig::default()
    };
    if let Err(err) = save_config(partial) {
        tracing::warn!(%err, "tunnel stop: save_config failed");
    }
    let _ = clear_config;
    ok_empty()
}

/// `TunnelStartBody` — `{ token?: string.min(1), url?: url() }`.
fn parse_start_body(body: &Value) -> Result<(Option<String>, Option<String>), String> {
    let token = match body.get("token") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        _ => return Err("Invalid token".to_string()),
    };
    let url = match body.get("url") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if is_url(s) => Some(s.clone()),
        _ => return Err("Invalid url".to_string()),
    };
    Ok((token, url))
}

/// `TunnelStopBody` — `{ clearConfig?: boolean }`.
fn parse_stop_body(body: &Value) -> Result<bool, String> {
    match body.get("clearConfig") {
        None | Some(Value::Null) => Ok(false),
        Some(Value::Bool(b)) => Ok(*b),
        _ => Err("Invalid clearConfig".to_string()),
    }
}

/// Minimal `z.url()` stand-in: a scheme + `://` + non-empty authority.
fn is_url(s: &str) -> bool {
    match s.split_once("://") {
        Some((scheme, rest)) => !scheme.is_empty() && !rest.is_empty(),
        None => false,
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/tunnel/status", get(get_status))
        .route("/api/tunnel/config", get(get_config_route))
        .route("/api/tunnel/start", post(start))
        .route("/api/tunnel/stop", post(stop))
}

// PORT STATUS: src/server/routes/tunnel.ts (108 lines)
// confidence: medium
// todos: 1
// notes: status = getUrl('daemon') + verify (cached /health probe); config reads
// getConfig hasToken/url. start gates on tunnel_manager + a non-zero port, validates
// the body (token min(1), url()), falls back to the persisted token/url, short-
// circuits an already-running tunnel when no new token is given, then start →
// set_tunnel_url → save_config (credentials only when both were provided). stop
// stops + set_tunnel_url(None) + save_config({tunnel:false}). KNOWN GAP: clearConfig
// cannot clear the persisted token/url because save_config's None means "keep"
// (mainframe-runtime is a done, off-limits crate) — see the TODO(port) above.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_body_validation() {
        assert_eq!(parse_start_body(&json!({})), Ok((None, None)));
        assert_eq!(
            parse_start_body(&json!({ "token": "t", "url": "https://x.com" })),
            Ok((Some("t".to_string()), Some("https://x.com".to_string())))
        );
        assert!(parse_start_body(&json!({ "token": "" })).is_err());
        assert!(parse_start_body(&json!({ "url": "not-a-url" })).is_err());
    }

    #[test]
    fn stop_body_validation() {
        assert_eq!(parse_stop_body(&json!({})), Ok(false));
        assert_eq!(parse_stop_body(&json!({ "clearConfig": true })), Ok(true));
        assert!(parse_stop_body(&json!({ "clearConfig": "yes" })).is_err());
    }
}
