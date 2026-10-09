//! `POST /mcp` — the orchestration MCP server's Streamable HTTP endpoint.
//!
//! Mounted beside the WS upgrades, outside both the device-token auth layer
//! (whose loopback bypass would admit any local process) and the response
//! compressor (the Claude CLI reads only gzip/deflate). It authenticates
//! itself with the per-spawn bearer token and refuses anything that looks
//! like browser or tunnel traffic. Stateless: no `Mcp-Session-Id`, no SSE.

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::header::{ALLOW, AUTHORIZATION, CONTENT_TYPE, ORIGIN, WWW_AUTHENTICATE};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::any;
use tower_http::limit::RequestBodyLimitLayer;

use mainframe_orchestration::{Caller, OrchestrationService, RpcReply, is_supported_version};

use crate::ctx::AppCtx;

/// One JSON-RPC message never needs more; the largest tool input is 100k chars.
pub const MCP_BODY_LIMIT_BYTES: usize = 1024 * 1024;

/// Headers a reverse proxy (the cloudflared tunnel) adds. The endpoint is for
/// processes the daemon spawned on this machine, never for remote callers.
const FORWARDING_HEADERS: [&str; 3] = ["forwarded", "x-forwarded-for", "cf-connecting-ip"];

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/mcp", any(handle))
        .route_layer(RequestBodyLimitLayer::new(MCP_BODY_LIMIT_BYTES))
}

async fn handle(State(ctx): State<Arc<AppCtx>>, req: Request) -> Response {
    let Some(service) = ctx.orchestration.as_ref() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    if req.method() != Method::POST {
        let mut resp = StatusCode::METHOD_NOT_ALLOWED.into_response();
        resp.headers_mut()
            .insert(ALLOW, HeaderValue::from_static("POST"));
        return resp;
    }
    let caller = match admit(service, req.headers()) {
        Ok(caller) => caller,
        Err(resp) => return resp,
    };
    let body = match axum::body::to_bytes(req.into_body(), MCP_BODY_LIMIT_BYTES).await {
        Ok(body) => body,
        Err(_) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
    };
    match service.handle(&caller, &body).await {
        RpcReply::Accepted => StatusCode::ACCEPTED.into_response(),
        RpcReply::Response(value) => json_response(StatusCode::OK, &value),
        RpcReply::BadRequest(value) => json_response(StatusCode::BAD_REQUEST, &value),
    }
}

/// Every check that needs only the headers, in the spec's order.
#[allow(clippy::result_large_err)]
fn admit(service: &OrchestrationService, headers: &HeaderMap) -> Result<Caller, Response> {
    if headers.contains_key(ORIGIN) {
        tracing::warn!(reason = "origin_header", "mcp request refused");
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    if FORWARDING_HEADERS.iter().any(|h| headers.contains_key(*h)) {
        tracing::warn!(reason = "forwarded_request", "mcp request refused");
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    let caller = authenticate(service, headers)?;
    let json = headers
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| {
            v.split(';')
                .next()
                .is_some_and(|m| m.trim().eq_ignore_ascii_case("application/json"))
        });
    if !json {
        return Err(StatusCode::UNSUPPORTED_MEDIA_TYPE.into_response());
    }
    let version = headers
        .get("mcp-protocol-version")
        .map(|v| v.to_str().unwrap_or(""));
    if version.is_some_and(|v| !is_supported_version(v)) {
        return Err(StatusCode::BAD_REQUEST.into_response());
    }
    Ok(caller)
}

#[allow(clippy::result_large_err)]
fn authenticate(service: &OrchestrationService, headers: &HeaderMap) -> Result<Caller, Response> {
    let token = headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|t| !t.is_empty());
    let reason = match token {
        None => "missing_token",
        Some(token) => match service.credentials().resolve(token) {
            Some(caller) => return Ok(caller),
            None => "unknown_token",
        },
    };
    tracing::warn!(reason, "mcp request unauthorized");
    let mut resp = StatusCode::UNAUTHORIZED.into_response();
    resp.headers_mut().insert(
        WWW_AUTHENTICATE,
        HeaderValue::from_static("Bearer realm=\"mainframe\""),
    );
    Err(resp)
}

fn json_response(status: StatusCode, value: &serde_json::Value) -> Response {
    let mut resp = (status, Body::from(value.to_string())).into_response();
    resp.headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    resp
}

#[cfg(test)]
#[path = "mcp_tests.rs"]
mod tests;
