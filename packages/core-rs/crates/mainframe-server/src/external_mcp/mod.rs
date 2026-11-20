mod auth;
#[cfg(test)]
mod auth_tests;
pub mod clients;
mod configure;
mod definitions;
mod dispatch;
mod input;
mod mutations;
#[cfg(test)]
mod permission_tests;
mod reads;
#[cfg(test)]
mod test_support;

use std::{net::SocketAddr, sync::Arc};

use axum::{
    Router,
    extract::{ConnectInfo, Request, State},
    http::{HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::any,
};
use mainframe_orchestration::{RpcReply, is_supported_version};
use tower_http::limit::RequestBodyLimitLayer;

use crate::ctx::AppCtx;

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/mcp/external", any(handle))
        .route_layer(RequestBodyLimitLayer::new(128 * 1024))
}

async fn handle(
    State(ctx): State<Arc<AppCtx>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    req: Request,
) -> Response {
    if !auth::local_request(peer, req.headers(), false) {
        return StatusCode::FORBIDDEN.into_response();
    }
    if req.method() != Method::POST {
        return (StatusCode::METHOD_NOT_ALLOWED, [("allow", "POST")]).into_response();
    }
    let client = match auth::authenticate(&ctx, req.headers()).await {
        Ok(client) => client,
        Err(status) => return unauthorized(status),
    };
    let content_type = req
        .headers()
        .get("content-type")
        .and_then(|h| h.to_str().ok());
    if !content_type.is_some_and(|h| {
        h.split(';')
            .next()
            .is_some_and(|v| v.trim().eq_ignore_ascii_case("application/json"))
    }) {
        return StatusCode::UNSUPPORTED_MEDIA_TYPE.into_response();
    }
    if req
        .headers()
        .get("mcp-protocol-version")
        .is_some_and(|v| !is_supported_version(v.to_str().unwrap_or_default()))
    {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let body = match axum::body::to_bytes(req.into_body(), 128 * 1024).await {
        Ok(body) => body,
        Err(_) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
    };
    let mut response = match dispatch::handle(&ctx, &client, &body).await {
        RpcReply::Accepted => StatusCode::ACCEPTED.into_response(),
        RpcReply::Response(value) => axum::Json(value).into_response(),
        RpcReply::BadRequest(value) => (StatusCode::BAD_REQUEST, axum::Json(value)).into_response(),
    };
    response
        .headers_mut()
        .insert("cache-control", HeaderValue::from_static("no-store"));
    response
}

fn unauthorized(status: StatusCode) -> Response {
    let mut response = status.into_response();
    if status == StatusCode::UNAUTHORIZED {
        response.headers_mut().insert(
            "www-authenticate",
            HeaderValue::from_static("Bearer realm=\"mainframe-external\""),
        );
    }
    response
}

#[cfg(test)]
mod continuation_tests;
