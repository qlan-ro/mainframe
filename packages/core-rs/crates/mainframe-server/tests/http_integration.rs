//! HTTP integration tests — translated from `middleware/__tests__/auth.test.ts`
//! (via reqwest against a real spawned app) plus `/health` shape and the CORS
//! contract. Auth is exercised through the mounted routers: an authenticated but
//! unmatched path returns `404` (auth passed), a rejected one returns `401`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::time::Duration;

use reqwest::{Method, StatusCode};
use support::spawn_test_server;

const SECRET: &str = "test-secret-key-at-least-32-chars-long!!";
const NON_LOOPBACK: &str = "192.168.1.100";

// ── /health (public) ────────────────────────────────────────────────────────

#[tokio::test]
async fn health_returns_ok_shape() {
    let server = spawn_test_server(None).await;
    let body: serde_json::Value = reqwest::get(server.http_url("/health"))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(body["status"], "ok");
    assert_eq!(body["version"], "0.0.0-test");
    // Main catch-up (#442): the health body identifies the port's owner pid.
    assert!(body["pid"].as_u64().is_some_and(|p| p > 0));
    assert!(body["tunnelUrl"].is_null());
    let ts = body["timestamp"].as_str().unwrap();
    assert!(ts.ends_with('Z'), "millis+Z ISO-8601: {ts}");
    assert_eq!(ts.len(), 24, "millis precision: {ts}");
    assert_eq!(&ts[19..20], ".");
}

// ── auth middleware ──────────────────────────────────────────────────────────

#[tokio::test]
async fn skips_auth_when_no_secret() {
    let server = spawn_test_server(None).await;
    // Unmatched path, no secret → auth is a no-op → 404 (reached the router), not 401.
    let status = reqwest::get(server.http_url("/api/anything"))
        .await
        .unwrap()
        .status();
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn allows_localhost_without_token() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let status = reqwest::get(server.http_url("/api/anything"))
        .await
        .unwrap()
        .status();
    assert_eq!(status, StatusCode::NOT_FOUND); // passed auth (loopback), no route
}

#[tokio::test]
async fn rejects_non_localhost_without_token() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let resp = reqwest::Client::new()
        .get(server.http_url("/api/anything"))
        .header("X-Forwarded-For", NON_LOOPBACK)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(
        body,
        serde_json::json!({ "success": false, "error": "Unauthorized" })
    );
}

#[tokio::test]
async fn rejects_forged_leftmost_loopback_hop_through_tunnel() {
    // Tunnel attack: cloudflared runs on loopback and appends the real client to
    // `X-Forwarded-For`. A forged leftmost `127.0.0.1` must NOT be treated as a
    // loopback bypass — Express `trust proxy = 'loopback'` (proxy-addr) resolves
    // the appended untrusted hop, so a tokenless request is rejected with 401.
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let status = reqwest::Client::new()
        .get(server.http_url("/api/auth/devices"))
        .header("X-Forwarded-For", format!("127.0.0.1, {NON_LOOPBACK}"))
        .send()
        .await
        .unwrap()
        .status();
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn accepts_non_localhost_with_valid_token() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let token = server.register_device_token(SECRET, "device-1").await;
    let status = reqwest::Client::new()
        .get(server.http_url("/api/anything"))
        .header("X-Forwarded-For", NON_LOOPBACK)
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .unwrap()
        .status();
    assert_eq!(status, StatusCode::NOT_FOUND); // passed auth, no route
}

#[tokio::test]
async fn rejects_non_localhost_with_invalid_token() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let status = reqwest::Client::new()
        .get(server.http_url("/api/anything"))
        .header("X-Forwarded-For", NON_LOOPBACK)
        .header("Authorization", "Bearer invalid-garbage")
        .send()
        .await
        .unwrap()
        .status();
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn allows_unauthenticated_auth_path_without_token() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    // /api/auth/confirm is public; non-loopback + no token must NOT be 401.
    let status = reqwest::Client::new()
        .post(server.http_url("/api/auth/confirm"))
        .header("X-Forwarded-For", NON_LOOPBACK)
        .send()
        .await
        .unwrap()
        .status();
    assert_ne!(status, StatusCode::UNAUTHORIZED);
    // Allowed through the auth layer; the now-live confirm handler rejects the
    // empty body with 400 (was 404 while the route was an unimplemented stub).
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn rejects_pair_path_from_non_localhost() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    // /api/auth/pair is NOT in the unauthenticated set.
    let status = reqwest::Client::new()
        .post(server.http_url("/api/auth/pair"))
        .header("X-Forwarded-For", NON_LOOPBACK)
        .send()
        .await
        .unwrap()
        .status();
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn health_always_allowed_from_non_localhost() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let status = reqwest::Client::new()
        .get(server.http_url("/health"))
        .header("X-Forwarded-For", NON_LOOPBACK)
        .send()
        .await
        .unwrap()
        .status();
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn rejects_token_for_deleted_device() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    // Valid signature, but the device was never registered.
    let token = mainframe_runtime::auth::generate_token(SECRET, "mobile-ghost", Some(1));
    let status = reqwest::Client::new()
        .get(server.http_url("/api/anything"))
        .header("X-Forwarded-For", NON_LOOPBACK)
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .unwrap()
        .status();
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn rejects_token_with_stale_epoch() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    // Register + bump the epoch once (that's the token), then bump again → stale.
    let stale_token = server.register_device_token(SECRET, "mobile-1").await;
    server
        .ctx
        .db
        .call(|db| db.devices.increment_auth_epoch("mobile-1"))
        .await
        .unwrap();
    let status = reqwest::Client::new()
        .get(server.http_url("/api/anything"))
        .header("X-Forwarded-For", NON_LOOPBACK)
        .header("Authorization", format!("Bearer {stale_token}"))
        .send()
        .await
        .unwrap()
        .status();
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

// ── CORS ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn options_preflight_returns_204_with_cors_headers() {
    let server = spawn_test_server(None).await;
    let resp = reqwest::Client::new()
        .request(Method::OPTIONS, server.http_url("/health"))
        .header("Origin", "http://localhost:5173")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        resp.headers().get("access-control-allow-origin").unwrap(),
        "http://localhost:5173"
    );
    assert_eq!(
        resp.headers().get("x-content-type-options").unwrap(),
        "nosniff"
    );
}

#[tokio::test]
async fn echoes_localhost_origin_but_not_foreign_origin() {
    let server = spawn_test_server(None).await;
    let client = reqwest::Client::new();

    let local = client
        .get(server.http_url("/health"))
        .header("Origin", "http://localhost:5173")
        .send()
        .await
        .unwrap();
    assert_eq!(
        local.headers().get("access-control-allow-origin").unwrap(),
        "http://localhost:5173"
    );

    let foreign = client
        .get(server.http_url("/health"))
        .header("Origin", "http://evil.com")
        .send()
        .await
        .unwrap();
    assert!(
        foreign
            .headers()
            .get("access-control-allow-origin")
            .is_none()
    );
    // nosniff is always set.
    assert_eq!(
        foreign.headers().get("x-content-type-options").unwrap(),
        "nosniff"
    );

    // Main catch-up (#411): the packaged-Tauri custom-scheme origin is echoed.
    let tauri = client
        .get(server.http_url("/health"))
        .header("Origin", "tauri://localhost")
        .send()
        .await
        .unwrap();
    assert_eq!(
        tauri.headers().get("access-control-allow-origin").unwrap(),
        "tauri://localhost"
    );
}

// A short delay is baked into spawn_test_server; expose the constant so the
// intent is obvious if a reader wonders why we don't poll for readiness.
#[allow(dead_code)]
const _READY_HINT: Duration = Duration::from_millis(20);
