//! Ported from `src/server/routes/auth.ts` — mobile pairing + device management.
//!
//! The pairing / rate-limit / recent-pairing maps are process-global in the TS
//! (module-level `Map`s shared across every router instance); they map to a
//! single `LazyLock<Mutex<AuthState>>` here with the exact TTLs and thresholds.
//! The `AUTH_TOKEN_SECRET` the TS reads per-request from `process.env` comes from
//! `AppCtx.auth_secret` (the daemon reads it once at boot); the devices repo and
//! push service are the `AppCtx` handles. `req.auth` (set by the auth middleware)
//! is read back from request extensions as `Extension<TokenPayload>`.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, LazyLock, Mutex};

use axum::Extension;
use axum::Router;
use axum::body::Bytes;
use axum::extract::{ConnectInfo, Query, State};
use axum::http::HeaderMap;
use axum::http::StatusCode;
use axum::http::header::AUTHORIZATION;
use axum::response::Response;
use axum::routing::{delete, get, post};
use mainframe_runtime::auth::{TokenPayload, generate_pairing_code, generate_token};
use serde::Deserialize;
use serde_json::json;

use crate::ctx::AppCtx;
use crate::middleware::auth::validate_device_token;
use crate::net::trust_proxy_client_ip;
use crate::respond::{fail, ok, ok_empty};
use crate::routes::projects::parse_body;

const PAIRING_EXPIRY_MS: i64 = 5 * 60 * 1000;
const MAX_PAIRING_ATTEMPTS: u32 = 5;
const RATE_LIMIT_WINDOW_MS: i64 = 60 * 1000;
const RATE_LIMIT_MAX_FAILURES: u32 = 10;
const RECENT_PAIRING_TTL_MS: i64 = 60 * 1000;

struct PendingPairing {
    device_name: String,
    created_at: i64,
    failed_attempts: u32,
}

struct RateLimitEntry {
    failures: u32,
    window_start: i64,
}

struct RecentPairing {
    device_id: String,
    device_name: String,
    consumed_at: i64,
}

#[derive(Default)]
struct AuthState {
    pending: HashMap<String, PendingPairing>,
    rate: HashMap<String, RateLimitEntry>,
    recent: HashMap<String, RecentPairing>,
}

static AUTH_STATE: LazyLock<Mutex<AuthState>> = LazyLock::new(|| Mutex::new(AuthState::default()));

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Test-only reset of the process-global pairing state (mirrors `_resetAuthState`).
pub fn reset_auth_state() {
    if let Ok(mut state) = AUTH_STATE.lock() {
        state.pending.clear();
        state.rate.clear();
        state.recent.clear();
    }
}

fn clean_recent_pairings(state: &mut AuthState) {
    let now = now_ms();
    state
        .recent
        .retain(|_, entry| now - entry.consumed_at <= RECENT_PAIRING_TTL_MS);
}

fn clean_expired_pairings(state: &mut AuthState) {
    let now = now_ms();
    state
        .pending
        .retain(|_, pairing| now - pairing.created_at <= PAIRING_EXPIRY_MS);
    state
        .rate
        .retain(|_, entry| now - entry.window_start <= RATE_LIMIT_WINDOW_MS);
    clean_recent_pairings(state);
}

fn is_rate_limited(state: &mut AuthState, ip: &str) -> bool {
    let Some(entry) = state.rate.get(ip) else {
        return false;
    };
    if now_ms() - entry.window_start > RATE_LIMIT_WINDOW_MS {
        state.rate.remove(ip);
        return false;
    }
    entry.failures >= RATE_LIMIT_MAX_FAILURES
}

fn record_failure(state: &mut AuthState, ip: &str) {
    let now = now_ms();
    match state.rate.get_mut(ip) {
        Some(entry) if now - entry.window_start <= RATE_LIMIT_WINDOW_MS => entry.failures += 1,
        _ => {
            state.rate.insert(
                ip.to_string(),
                RateLimitEntry {
                    failures: 1,
                    window_start: now,
                },
            );
        }
    }
}

#[derive(Deserialize)]
struct ConfirmBody {
    #[serde(rename = "pairingCode")]
    pairing_code: String,
    #[serde(rename = "deviceName")]
    device_name: Option<String>,
    #[serde(rename = "clientDeviceId")]
    client_device_id: String,
}

#[derive(Deserialize)]
struct RegisterPushBody {
    #[serde(rename = "deviceId")]
    device_id: String,
    #[serde(rename = "pushToken")]
    push_token: String,
}

fn is_valid_uuid(s: &str) -> bool {
    // /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    let bytes = s.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    let groups = [8usize, 4, 4, 4, 12];
    let mut idx = 0;
    for (g, &len) in groups.iter().enumerate() {
        if g > 0 {
            if bytes[idx] != b'-' {
                return false;
            }
            idx += 1;
        }
        for i in 0..len {
            let c = bytes[idx + i];
            let hex = c.is_ascii_digit() || (b'a'..=b'f').contains(&c.to_ascii_lowercase());
            if !hex {
                return false;
            }
        }
        // Version nibble (group index 2) must be 1-5; variant nibble (group 3) 8/9/a/b.
        if g == 2 {
            let v = bytes[idx].to_ascii_lowercase();
            if !(b'1'..=b'5').contains(&v) {
                return false;
            }
        }
        if g == 3 {
            let v = bytes[idx].to_ascii_lowercase();
            if !matches!(v, b'8' | b'9' | b'a' | b'b') {
                return false;
            }
        }
        idx += len;
    }
    idx == bytes.len()
}

fn is_valid_pair_code(s: &str) -> bool {
    // /^[A-Z0-9]{6}$/
    s.len() == 6
        && s.bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
}

fn bearer_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get(AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .map(str::to_string)
}

fn client_ip_from(peer: &SocketAddr, headers: &HeaderMap) -> String {
    let forwarded = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok());
    // `req.ip` for the confirm rate-limit key uses Express trust-proxy=loopback,
    // the same proxy-addr rule as the auth middleware (not the WS first-hop rule).
    trust_proxy_client_ip(&peer.ip().to_string(), forwarded)
}

async fn pair(State(ctx): State<Arc<AppCtx>>) -> Response {
    if ctx.auth_secret.is_none() {
        return fail(StatusCode::BAD_REQUEST, "Auth not configured");
    }
    let code = generate_pairing_code();
    if let Ok(mut state) = AUTH_STATE.lock() {
        state.pending.insert(
            code.clone(),
            PendingPairing {
                device_name: "Unknown Device".to_string(),
                created_at: now_ms(),
                failed_attempts: 0,
            },
        );
        clean_expired_pairings(&mut state);
    }
    ok(json!({ "pairingCode": code }))
}

/// Outcome of the synchronous (locked) pre-DB confirm validation.
enum ConfirmOutcome {
    Reject(Response),
    Proceed { device_id: String, name: String },
}

async fn confirm(
    State(ctx): State<Arc<AppCtx>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Some(secret) = ctx.auth_secret.clone() else {
        return fail(StatusCode::BAD_REQUEST, "Auth not configured");
    };
    let ip = client_ip_from(&peer, &headers);

    let Some(parsed): Option<ConfirmBody> = parse_body(&body) else {
        // Rate limit is checked before body parse in the TS; mirror that order.
        if let Ok(mut state) = AUTH_STATE.lock()
            && is_rate_limited(&mut state, &ip)
        {
            return fail(
                StatusCode::TOO_MANY_REQUESTS,
                "Too many attempts, try again later",
            );
        }
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    // confirmBodySchema: pairingCode.min(1), deviceName.min(1).optional,
    // clientDeviceId.uuid. serde alone accepts an empty pairingCode or an
    // empty-but-present deviceName, both of which Zod rejects — fold those into
    // the same rate-limit-then-400 path so a Zod-rejected body never pairs.
    if parsed.pairing_code.is_empty()
        || parsed.device_name.as_deref() == Some("")
        || !is_valid_uuid(&parsed.client_device_id)
    {
        if let Ok(mut state) = AUTH_STATE.lock()
            && is_rate_limited(&mut state, &ip)
        {
            return fail(
                StatusCode::TOO_MANY_REQUESTS,
                "Too many attempts, try again later",
            );
        }
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    }

    let outcome = {
        let Ok(mut state) = AUTH_STATE.lock() else {
            return fail(StatusCode::INTERNAL_SERVER_ERROR, "Internal server error");
        };
        if is_rate_limited(&mut state, &ip) {
            return fail(
                StatusCode::TOO_MANY_REQUESTS,
                "Too many attempts, try again later",
            );
        }
        clean_expired_pairings(&mut state);

        match state.pending.get_mut(&parsed.pairing_code) {
            None => {
                record_failure(&mut state, &ip);
                ConfirmOutcome::Reject(fail(
                    StatusCode::UNAUTHORIZED,
                    "Invalid or expired pairing code",
                ))
            }
            Some(pairing) if now_ms() - pairing.created_at > PAIRING_EXPIRY_MS => {
                state.pending.remove(&parsed.pairing_code);
                record_failure(&mut state, &ip);
                ConfirmOutcome::Reject(fail(
                    StatusCode::UNAUTHORIZED,
                    "Invalid or expired pairing code",
                ))
            }
            Some(pairing) => {
                pairing.failed_attempts += 1;
                if pairing.failed_attempts > MAX_PAIRING_ATTEMPTS {
                    state.pending.remove(&parsed.pairing_code);
                    record_failure(&mut state, &ip);
                    ConfirmOutcome::Reject(fail(
                        StatusCode::UNAUTHORIZED,
                        "Too many failed attempts, pairing code invalidated",
                    ))
                } else {
                    let default_name = pairing.device_name.clone();
                    state.pending.remove(&parsed.pairing_code);
                    let device_id = format!("mobile-{}", parsed.client_device_id);
                    let name = parsed.device_name.clone().unwrap_or(default_name);
                    ConfirmOutcome::Proceed { device_id, name }
                }
            }
        }
    };

    let (device_id, name) = match outcome {
        ConfirmOutcome::Reject(resp) => return resp,
        ConfirmOutcome::Proceed { device_id, name } => (device_id, name),
    };

    let did = device_id.clone();
    let dname = name.clone();
    let epoch = match ctx
        .db
        .call(move |db| {
            db.devices.add(&did, &dname)?;
            db.devices.increment_auth_epoch(&did)
        })
        .await
    {
        Ok(epoch) => epoch,
        Err(err) => return crate::async_err::internal_error("confirm pairing", &err),
    };

    let token = generate_token(&secret, &device_id, Some(epoch));

    if let Ok(mut state) = AUTH_STATE.lock() {
        state.recent.insert(
            parsed.pairing_code.clone(),
            RecentPairing {
                device_id: device_id.clone(),
                device_name: name,
                consumed_at: now_ms(),
            },
        );
    }

    ok(json!({ "token": token, "deviceId": device_id }))
}

async fn status(State(ctx): State<Arc<AppCtx>>, headers: HeaderMap) -> Response {
    let Some(secret) = ctx.auth_secret.clone() else {
        return ok(json!({ "valid": true, "authEnabled": false }));
    };
    let Some(token) = bearer_token(&headers) else {
        return ok(json!({ "valid": false }));
    };
    match validate_device_token(&ctx.db, secret, token).await {
        Some(payload) => ok(json!({ "valid": true, "deviceId": payload.device_id })),
        None => ok(json!({ "valid": false })),
    }
}

async fn register_push(
    State(ctx): State<Arc<AppCtx>>,
    auth: Option<Extension<TokenPayload>>,
    body: Bytes,
) -> Response {
    let Some(Extension(auth)) = auth else {
        return fail(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    let Some(parsed): Option<RegisterPushBody> = parse_body(&body) else {
        return fail(StatusCode::BAD_REQUEST, "Missing deviceId or pushToken");
    };
    if parsed.device_id.is_empty() || parsed.push_token.is_empty() {
        return fail(StatusCode::BAD_REQUEST, "Missing deviceId or pushToken");
    }
    if parsed.device_id != auth.device_id {
        return fail(StatusCode::FORBIDDEN, "Device mismatch");
    }
    ctx.services
        .push
        .register_device(&parsed.device_id, &parsed.push_token);
    ok_empty()
}

async fn list_devices(State(ctx): State<Arc<AppCtx>>) -> Response {
    match ctx.db.call(|db| db.devices.get_all()).await {
        Ok(devices) => ok(devices),
        Err(err) => crate::async_err::internal_error("list devices", &err),
    }
}

async fn delete_device(
    State(ctx): State<Arc<AppCtx>>,
    axum::extract::Path(device_id): axum::extract::Path<String>,
) -> Response {
    let did = device_id.clone();
    if let Err(err) = ctx.db.call(move |db| db.devices.remove(&did)).await {
        return crate::async_err::internal_error("remove device", &err);
    }
    ctx.services.push.unregister_device(&device_id);
    ok_empty()
}

async fn pair_status(Query(params): Query<HashMap<String, String>>) -> Response {
    let Some(code) = params.get("code") else {
        return fail(StatusCode::BAD_REQUEST, "Invalid code");
    };
    if !is_valid_pair_code(code) {
        return fail(StatusCode::BAD_REQUEST, "Invalid code");
    }
    let Ok(mut state) = AUTH_STATE.lock() else {
        return fail(StatusCode::INTERNAL_SERVER_ERROR, "Internal server error");
    };
    clean_recent_pairings(&mut state);
    match state.recent.get(code) {
        None => ok(json!({ "paired": false })),
        Some(entry) => ok(json!({
            "paired": true,
            "deviceId": entry.device_id,
            "deviceName": entry.device_name,
        })),
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/auth/pair", post(pair))
        .route("/api/auth/confirm", post(confirm))
        .route("/api/auth/status", get(status))
        .route("/api/auth/register-push", post(register_push))
        .route("/api/auth/devices", get(list_devices))
        .route("/api/auth/devices/{deviceId}", delete(delete_device))
        .route("/api/auth/pair-status", get(pair_status))
}

// PORT STATUS: src/server/routes/auth.ts (7 endpoints, 249 lines)
// confidence: high
// todos: 0
// notes: module-global pairing/rate-limit/recent Maps → one LazyLock<Mutex<AuthState>>
// (process-global, matching TS semantics) with identical TTLs/thresholds;
// `_resetAuthState` → `reset_auth_state`. Secret read from AppCtx.auth_secret (boot
// value), not process.env. `req.ip` (trust-proxy=loopback) → net::trust_proxy_client_ip
// over ConnectInfo + x-forwarded-for. `req.auth` → Extension<TokenPayload>. Zod schemas
// (confirmBodySchema uuid+min1, registerPushSchema min1, pairStatusQuerySchema
// [A-Z0-9]{6}) → serde parse + explicit refinements (is_valid_uuid, non-empty,
// is_valid_pair_code). devices/push via AppCtx handles. No QR payload is emitted by
// this route (the terminal QR is CLI-side, per the task note). Locks are never held
// across an await (confirm validates + drops the lock before the DB call).
