//! GitHub App device flow routes. `start` and `poll` each make one call to
//! GitHub; the editor's connect UI owns the polling loop. A successful poll
//! stores the token (plus a GitHub App's refresh token and expiry) under the
//! `github` credential label and never echoes it back, like
//! `PUT /api/automation-credentials`. `device/status` tells the UI whether to
//! offer sign-in-with-GitHub beside the token field; it never touches GitHub.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::{get, post};
use mainframe_automations::AutomationsEngine;
use mainframe_github::device::{
    DeviceFlowError, DeviceStart, GITHUB_APP_CLIENT_ID, GithubDeviceFlow, PollOutcome,
};
use serde::Deserialize;
use serde_json::json;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok};
use crate::routes::automations::{engine, unavailable};
use crate::routes::body::parse_body;

const GITHUB_CREDENTIAL_LABEL: &str = "github";

async fn device_flow_status() -> Response {
    device_flow_status_for(GITHUB_APP_CLIENT_ID)
}

/// Takes the client ID so a test can pin the unconfigured contract without
/// depending on the shipped constant.
fn device_flow_status_for(client_id: &str) -> Response {
    ok(json!({ "configured": !client_id.is_empty() }))
}

async fn start_device_flow(State(ctx): State<Arc<AppCtx>>) -> Response {
    if engine(&ctx).is_none() {
        return unavailable();
    }
    let result = match GithubDeviceFlow::new() {
        Ok(flow) => flow.start().await,
        Err(err) => Err(err),
    };
    start_response(result)
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
        DeviceFlowError::Network(_)
        | DeviceFlowError::Rejected(_)
        | DeviceFlowError::UnexpectedResponse(_) => fail(StatusCode::BAD_GATEWAY, err.to_string()),
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
    match GithubDeviceFlow::new() {
        Ok(flow) => poll_and_respond(&flow, &parsed.device_code, engine).await,
        Err(err) => device_flow_error_response(&err),
    }
}

/// Split from the handler so tests can point the flow at a mock server.
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
                Err(err) => crate::respond::fail_internal(
                    "failed to persist the GitHub device-flow token",
                    &err,
                    "failed to save the GitHub connection",
                ),
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
    let now_ms = mainframe_types::time::now_ms();
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
