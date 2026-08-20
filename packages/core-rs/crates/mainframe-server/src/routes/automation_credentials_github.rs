//! GitHub App device flow routes (2026-08-19 provider-connections plan,
//! Deliverable 3; token-refresh fields added by the GitHub-App-with-refresh
//! plan) — the one connector that gets a real OAuth flow. `start` and `poll`
//! each make exactly one call to GitHub; the client (the editor's connect
//! UI) owns the interval-respecting retry loop. A successful poll persists
//! the token (plus, for a GitHub App, its refresh token and expiry) under
//! the well-known `github` credential label and never echoes it back — same
//! rule as `PUT /api/automation-credentials`. `device/status` is a separate,
//! no-op-cheap route the UI probes on mount to decide whether to offer the
//! sign-in-with-GitHub button alongside the always-available token field
//! (`GithubCredentialConnect.tsx`) — it never touches GitHub.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::{get, post};
use mainframe_automations::AutomationsEngine;
use mainframe_automations::github_device::{
    DeviceFlowError, DeviceStart, GithubDeviceFlow, PollOutcome,
};
use serde::Deserialize;
use serde_json::json;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok};
use crate::routes::automations::{engine, unavailable};
use crate::routes::projects::parse_body;

const GITHUB_CREDENTIAL_LABEL: &str = "github";

async fn device_flow_status() -> Response {
    device_flow_status_for(&GithubDeviceFlow::new()).await
}

/// Split from the handler so a test can pin the unconfigured contract with an
/// injected client ID instead of depending on this repo's own app never being
/// registered.
async fn device_flow_status_for(flow: &GithubDeviceFlow) -> Response {
    ok(json!({ "configured": flow.is_configured() }))
}

async fn start_device_flow(State(ctx): State<Arc<AppCtx>>) -> Response {
    if engine(&ctx).is_none() {
        return unavailable();
    }
    start_response(GithubDeviceFlow::new().start().await)
}

fn start_response(result: Result<DeviceStart, DeviceFlowError>) -> Response {
    match result {
        Ok(started) => ok(json!({
            "deviceCode": started.device_code,
            "userCode": started.user_code,
            "verificationUri": started.verification_uri,
            "interval": started.interval,
            "expiresIn": started.expires_in,
        })),
        Err(err) => device_flow_error_response(&err),
    }
}

fn device_flow_error_response(err: &DeviceFlowError) -> Response {
    match err {
        DeviceFlowError::NotConfigured => fail(StatusCode::NOT_IMPLEMENTED, err.to_string()),
        DeviceFlowError::Network(_) | DeviceFlowError::UnexpectedResponse(_) => {
            fail(StatusCode::BAD_GATEWAY, err.to_string())
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PollBody {
    device_code: String,
}

async fn poll_device_flow(State(ctx): State<Arc<AppCtx>>, body: Bytes) -> Response {
    let Some(engine) = engine(&ctx) else {
        return unavailable();
    };
    let Some(parsed): Option<PollBody> = parse_body(&body) else {
        return fail(
            StatusCode::BAD_REQUEST,
            "body must be { deviceCode: string }",
        );
    };
    poll_and_respond(&GithubDeviceFlow::new(), &parsed.device_code, engine).await
}

/// Shared by the real route and its tests — the real route drives a
/// `GithubDeviceFlow` pointed at GitHub, tests point one at a mock server.
async fn poll_and_respond(
    flow: &GithubDeviceFlow,
    device_code: &str,
    engine: &AutomationsEngine,
) -> Response {
    match flow.poll_once(device_code).await {
        Ok(PollOutcome::Connected {
            token,
            expires_in,
            refresh_token,
        }) => {
            let expires_at = expires_in.map(epoch_ms_after);
            match engine
                .set_credential_full(GITHUB_CREDENTIAL_LABEL, token, refresh_token, expires_at)
                .await
            {
                Ok(()) => ok(json!({ "status": "connected" })),
                Err(err) => {
                    tracing::error!(error = %err, "failed to persist the GitHub device-flow token");
                    fail(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "failed to save the GitHub connection",
                    )
                }
            }
        }
        Ok(PollOutcome::Pending) => ok(json!({ "status": "pending" })),
        Ok(PollOutcome::SlowDown { new_interval }) => {
            ok(json!({ "status": "slow_down", "interval": new_interval }))
        }
        Ok(PollOutcome::Expired) => ok(json!({ "status": "expired" })),
        Ok(PollOutcome::Denied) => ok(json!({ "status": "denied" })),
        Ok(PollOutcome::Other(message)) => ok(json!({ "status": "error", "message": message })),
        Err(err) => device_flow_error_response(&err),
    }
}

/// Wall-clock ms this many seconds from now, for a GitHub-App token's
/// `expires_at` — GitHub reports expiry as a duration, not an instant.
fn epoch_ms_after(seconds: u64) -> i64 {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    now_ms + seconds as i64 * 1000
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route(
            "/api/automation-credentials/github/device/status",
            get(device_flow_status),
        )
        .route(
            "/api/automation-credentials/github/device/start",
            post(start_device_flow),
        )
        .route(
            "/api/automation-credentials/github/device/poll",
            post(poll_device_flow),
        )
}

#[cfg(test)]
mod automation_credentials_github_tests;
