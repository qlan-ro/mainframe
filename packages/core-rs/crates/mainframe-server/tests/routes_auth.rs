//! Integration tests for `routes/auth.rs` — translated assertion-for-assertion
//! from `src/server/routes/__tests__/auth.test.ts` against a real spawned app
//! (reqwest + in-memory DB + real PushService). Rate-limit-recording cases use a
//! distinct `X-Forwarded-For` so the process-global rate-limit bucket never
//! collides across the parallel tests.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use reqwest::StatusCode;
use serde_json::json;
use support::spawn_test_server;

const SECRET: &str = "test-secret-key-at-least-32-chars-long!!";
const UUID: &str = "11111111-2222-4333-8444-555555555555";

fn client() -> reqwest::Client {
    reqwest::Client::new()
}

// ── pair ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn pair_initiates_pairing() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let resp = client()
        .post(server.http_url("/api/auth/pair"))
        .json(&json!({ "deviceName": "My iPhone" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["success"], true);
    let code = body["data"]["pairingCode"].as_str().unwrap();
    assert_eq!(code.len(), 6);
    assert!(
        code.chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
    );
}

#[tokio::test]
async fn pair_returns_400_when_auth_not_configured() {
    let server = spawn_test_server(None).await;
    let resp = client()
        .post(server.http_url("/api/auth/pair"))
        .json(&json!({ "deviceName": "My iPhone" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

// ── confirm ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn confirm_rejects_invalid_code() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let resp = client()
        .post(server.http_url("/api/auth/confirm"))
        .header("X-Forwarded-For", "203.0.113.10")
        .json(&json!({ "pairingCode": "INVALID", "clientDeviceId": UUID }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn confirm_rate_limits_after_too_many_failures() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    for i in 0..10 {
        client()
            .post(server.http_url("/api/auth/confirm"))
            .header("X-Forwarded-For", "203.0.113.20")
            .json(&json!({ "pairingCode": format!("WRONG{i}"), "clientDeviceId": UUID }))
            .send()
            .await
            .unwrap();
    }
    let resp = client()
        .post(server.http_url("/api/auth/confirm"))
        .header("X-Forwarded-For", "203.0.113.20")
        .json(&json!({ "pairingCode": "WRONG99", "clientDeviceId": UUID }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn confirm_exchanges_code_for_token() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let code = pair(&server).await;
    let resp = client()
        .post(server.http_url("/api/auth/confirm"))
        .json(&json!({ "pairingCode": code, "clientDeviceId": UUID }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body["data"]["token"].as_str().is_some());
}

#[tokio::test]
async fn confirm_accepts_device_name_from_mobile() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let code = pair(&server).await;
    let resp = client()
        .post(server.http_url("/api/auth/confirm"))
        .json(&json!({ "pairingCode": code, "deviceName": "iOS device", "clientDeviceId": UUID }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body["data"]["token"].as_str().is_some());
}

#[tokio::test]
async fn confirm_rejects_empty_device_name() {
    // confirmBodySchema.deviceName is `.min(1).optional()` — an empty-but-present
    // deviceName is a Zod parse failure (400), it must NOT pair the device (200).
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let code = pair(&server).await;
    let resp = client()
        .post(server.http_url("/api/auth/confirm"))
        .header("X-Forwarded-For", "203.0.113.31")
        .json(&json!({ "pairingCode": code, "deviceName": "", "clientDeviceId": UUID }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let devices = server.ctx.db.call(|db| db.devices.get_all()).await.unwrap();
    assert!(devices.is_empty());
}

#[tokio::test]
async fn confirm_rejects_empty_pairing_code() {
    // confirmBodySchema.pairingCode is `.min(1)` — an empty code is a Zod parse
    // failure (400), NOT the "invalid or expired" 401 an absent code produces.
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let resp = client()
        .post(server.http_url("/api/auth/confirm"))
        .header("X-Forwarded-For", "203.0.113.32")
        .json(&json!({ "pairingCode": "", "clientDeviceId": UUID }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn confirm_persists_device_with_name_from_mobile() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let code = pair(&server).await;
    client()
        .post(server.http_url("/api/auth/confirm"))
        .json(&json!({ "pairingCode": code, "deviceName": "My iPhone", "clientDeviceId": UUID }))
        .send()
        .await
        .unwrap();
    let devices = server.ctx.db.call(|db| db.devices.get_all()).await.unwrap();
    assert_eq!(devices.len(), 1);
    assert_eq!(devices[0].device_name, "My iPhone");
}

#[tokio::test]
async fn confirm_same_uuid_twice_returns_same_id_and_one_row() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let c1 = confirm_ok(&server, "iPhone").await;
    assert_eq!(c1["data"]["deviceId"], format!("mobile-{UUID}"));
    let c2 = confirm_ok(&server, "iPhone Renamed").await;
    assert_eq!(c2["data"]["deviceId"], format!("mobile-{UUID}"));
    let devices = server.ctx.db.call(|db| db.devices.get_all()).await.unwrap();
    assert_eq!(devices.len(), 1);
}

#[tokio::test]
async fn previous_token_rejected_after_repair() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let c1 = confirm_ok(&server, "iPhone").await;
    let old_token = c1["data"]["token"].as_str().unwrap().to_string();
    confirm_ok(&server, "iPhone").await;

    let probe = client()
        .get(server.http_url("/api/auth/devices"))
        .header("X-Forwarded-For", "198.51.100.7")
        .header("Authorization", format!("Bearer {old_token}"))
        .send()
        .await
        .unwrap();
    assert_eq!(probe.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn confirm_400_without_client_device_id() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let code = pair(&server).await;
    let resp = client()
        .post(server.http_url("/api/auth/confirm"))
        .header("X-Forwarded-For", "203.0.113.30")
        .json(&json!({ "pairingCode": code, "deviceName": "iPhone" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn confirm_400_with_malformed_client_device_id() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let code = pair(&server).await;
    let resp = client()
        .post(server.http_url("/api/auth/confirm"))
        .header("X-Forwarded-For", "203.0.113.31")
        .json(
            &json!({ "pairingCode": code, "deviceName": "iPhone", "clientDeviceId": "not-a-uuid" }),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn confirm_records_pairing_for_pair_status() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let code = pair(&server).await;
    client()
        .post(server.http_url("/api/auth/confirm"))
        .json(&json!({ "pairingCode": code, "deviceName": "My iPhone", "clientDeviceId": UUID }))
        .send()
        .await
        .unwrap();
    let status: serde_json::Value = client()
        .get(server.http_url(&format!("/api/auth/pair-status?code={code}")))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(status["data"]["paired"], true);
    assert_eq!(status["data"]["deviceId"], format!("mobile-{UUID}"));
    assert_eq!(status["data"]["deviceName"], "My iPhone");
}

// ── status ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn status_returns_invalid_for_bad_token() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let body: serde_json::Value = client()
        .get(server.http_url("/api/auth/status"))
        .header("Authorization", "Bearer bad-token")
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(body["data"]["valid"], false);
}

#[tokio::test]
async fn status_validates_a_token() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let token = server.register_device_token(SECRET, "mobile-status").await;
    let body: serde_json::Value = client()
        .get(server.http_url("/api/auth/status"))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(body["data"]["valid"], true);
}

#[tokio::test]
async fn status_invalid_for_missing_device_row() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let token = mainframe_runtime::auth::generate_token(SECRET, "mobile-ghost", Some(1));
    let body: serde_json::Value = client()
        .get(server.http_url("/api/auth/status"))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(body["data"]["valid"], false);
}

#[tokio::test]
async fn status_invalid_for_stale_epoch() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let token = server.register_device_token(SECRET, "mobile-stale").await;
    server
        .ctx
        .db
        .call(|db| db.devices.increment_auth_epoch("mobile-stale"))
        .await
        .unwrap();
    let body: serde_json::Value = client()
        .get(server.http_url("/api/auth/status"))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(body["data"]["valid"], false);
}

// ── pair-status ──────────────────────────────────────────────────────────────

#[tokio::test]
async fn pair_status_returns_false_before_consumption() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let resp = client()
        .get(server.http_url("/api/auth/pair-status?code=ZZZ123"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["data"]["paired"], false);
}

#[tokio::test]
async fn pair_status_400_on_malformed_code() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let resp = client()
        .get(server.http_url("/api/auth/pair-status?code=bad!"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

// ── devices ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn devices_lists_paired_devices() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    server
        .ctx
        .db
        .call(|db| {
            db.devices.add("mobile-l1", "iPhone")?;
            db.devices.add("mobile-l2", "iPad")
        })
        .await
        .unwrap();
    let body: serde_json::Value = client()
        .get(server.http_url("/api/auth/devices"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(body["data"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn delete_device_removes_it() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    server
        .ctx
        .db
        .call(|db| db.devices.add("mobile-del", "iPhone"))
        .await
        .unwrap();
    let resp = client()
        .delete(server.http_url("/api/auth/devices/mobile-del"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let remaining = server.ctx.db.call(|db| db.devices.get_all()).await.unwrap();
    assert_eq!(remaining.len(), 0);
}

#[tokio::test]
async fn delete_device_unregisters_push() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let token = server.register_device_token(SECRET, "mobile-push").await;
    // Register a push token (loopback + bearer → 200).
    let reg = client()
        .post(server.http_url("/api/auth/register-push"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({ "deviceId": "mobile-push", "pushToken": "tok" }))
        .send()
        .await
        .unwrap();
    assert_eq!(reg.status(), StatusCode::OK);
    assert!(server.ctx.services.push.has_registered_devices());

    client()
        .delete(server.http_url("/api/auth/devices/mobile-push"))
        .send()
        .await
        .unwrap();
    assert!(!server.ctx.services.push.has_registered_devices());
}

// ── register-push ────────────────────────────────────────────────────────────

#[tokio::test]
async fn register_push_401_without_bearer_non_localhost() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let resp = client()
        .post(server.http_url("/api/auth/register-push"))
        .header("X-Forwarded-For", "192.168.1.100")
        .json(&json!({ "deviceId": "mobile-x", "pushToken": "tok" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn register_push_403_on_device_mismatch() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let token = server.register_device_token(SECRET, "mobile-a").await;
    let resp = client()
        .post(server.http_url("/api/auth/register-push"))
        .header("X-Forwarded-For", "192.168.1.100")
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({ "deviceId": "mobile-b", "pushToken": "tok" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn register_push_200_when_authenticated_and_matching() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let token = server.register_device_token(SECRET, "mobile-a").await;
    let resp = client()
        .post(server.http_url("/api/auth/register-push"))
        .header("X-Forwarded-For", "192.168.1.100")
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({ "deviceId": "mobile-a", "pushToken": "tok" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn register_push_localhost_without_bearer_401() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let resp = client()
        .post(server.http_url("/api/auth/register-push"))
        .json(&json!({ "deviceId": "mobile-x", "pushToken": "tok" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn register_push_localhost_with_bearer_200() {
    let server = spawn_test_server(Some(SECRET.to_string())).await;
    let token = server.register_device_token(SECRET, "mobile-a").await;
    let resp = client()
        .post(server.http_url("/api/auth/register-push"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({ "deviceId": "mobile-a", "pushToken": "tok" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

// ── helpers ──────────────────────────────────────────────────────────────────

async fn pair(server: &support::TestServer) -> String {
    let body: serde_json::Value = client()
        .post(server.http_url("/api/auth/pair"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    body["data"]["pairingCode"].as_str().unwrap().to_string()
}

async fn confirm_ok(server: &support::TestServer, device_name: &str) -> serde_json::Value {
    let code = pair(server).await;
    let resp = client()
        .post(server.http_url("/api/auth/confirm"))
        .json(&json!({ "pairingCode": code, "deviceName": device_name, "clientDeviceId": UUID }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    resp.json().await.unwrap()
}
