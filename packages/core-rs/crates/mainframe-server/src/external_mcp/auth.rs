use std::net::SocketAddr;

use axum::http::{HeaderMap, StatusCode};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use mainframe_types::external_mcp::ExternalMcpClient;
use rand::RngCore;
use sha2::{Digest, Sha256};

use crate::ctx::AppCtx;

pub fn local_request(peer: SocketAddr, headers: &HeaderMap, browser: bool) -> bool {
    if !peer.ip().is_loopback()
        || ["forwarded", "x-forwarded-for", "cf-connecting-ip"]
            .iter()
            .any(|name| headers.contains_key(*name))
    {
        return false;
    }
    let host = headers.get("host").and_then(|v| v.to_str().ok());
    let host_ok = host.is_some_and(|h| {
        h == "localhost"
            || h.starts_with("localhost:")
            || h == "127.0.0.1"
            || h.starts_with("127.0.0.1:")
            || h == "[::1]"
            || h.starts_with("[::1]:")
    });
    let origin_ok = match headers.get("origin") {
        None => true,
        Some(origin) => browser && crate::cors_origin::is_allowed_origin(origin.to_str().ok()),
    };
    host_ok && origin_ok
}

pub fn token_hash(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

pub fn new_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    format!("mf_ext_{}", URL_SAFE_NO_PAD.encode(bytes))
}

pub async fn authenticate(
    ctx: &AppCtx,
    headers: &HeaderMap,
) -> Result<ExternalMcpClient, StatusCode> {
    let token = headers
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .filter(|v| v.starts_with("mf_ext_") && v.len() == 50)
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let hash = token_hash(token);
    ctx.core
        .db
        .call(move |db| db.external_mcp.authenticate(&hash))
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::UNAUTHORIZED)
}
