//! GitHub OAuth device flow (2026-08-19 provider-connections plan,
//! Deliverable 3) — the one provider that gets real OAuth, because device
//! flow's token exchange needs only `client_id`, `device_code`, and
//! `grant_type`; GitHub's docs state the client secret is "not needed for
//! the device flow". No redirect URI, no PKCE, no `state` — none of that
//! applies to a flow that never redirects.
//!
//! `GITHUB_OAUTH_CLIENT_ID` is the single place the registered OAuth App's
//! client ID goes once it exists; empty means "not configured yet" and
//! `start()` reports that explicitly rather than making a doomed request.
//!
//! `poll_once` makes exactly one probe against GitHub's token endpoint and
//! maps the response to a `PollOutcome` — it does not loop or sleep itself.
//! The caller (the daemon route) drives the interval; `SlowDown` carries the
//! new interval GitHub asked for, per the docs' "5 extra seconds" rule.

use serde::Deserialize;

use crate::USER_AGENT;

/// Set this once the GitHub OAuth App (device flow enabled) is registered —
/// see the daemon operator docs. Empty = device flow is unavailable.
pub const GITHUB_OAUTH_CLIENT_ID: &str = "";

const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:device_code";

#[derive(Debug, Clone, PartialEq)]
pub struct DeviceStart {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub interval: u64,
    pub expires_in: u64,
}

#[derive(Debug, Deserialize)]
struct DeviceStartBody {
    device_code: String,
    user_code: String,
    verification_uri: String,
    interval: u64,
    expires_in: u64,
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum DeviceFlowError {
    #[error("GitHub connection isn't set up yet — no OAuth App client ID is configured")]
    NotConfigured,
    #[error("GitHub device flow request failed: {0}")]
    Network(String),
    #[error("GitHub device flow request failed: unexpected response ({0})")]
    UnexpectedResponse(String),
}

/// One outcome of a single poll against the token endpoint — never loops or
/// sleeps; the caller owns the interval.
#[derive(Debug, Clone, PartialEq)]
pub enum PollOutcome {
    Connected {
        token: String,
    },
    /// The user hasn't entered the code yet — keep polling at `interval`.
    Pending,
    /// Poll faster than allowed; wait `new_interval` seconds from now on.
    SlowDown {
        new_interval: u64,
    },
    /// The device/user code expired (15 minutes) — start over.
    Expired,
    /// The user clicked cancel.
    Denied,
    /// Any other `error` GitHub returned — surfaced verbatim.
    Other(String),
}

pub struct GithubDeviceFlow {
    client: reqwest::Client,
    device_code_url: String,
    token_url: String,
    client_id: &'static str,
}

impl GithubDeviceFlow {
    pub fn new() -> Self {
        Self::with_urls(DEVICE_CODE_URL, TOKEN_URL, GITHUB_OAUTH_CLIENT_ID)
    }

    pub fn with_urls(
        device_code_url: impl Into<String>,
        token_url: impl Into<String>,
        client_id: &'static str,
    ) -> Self {
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            client,
            device_code_url: device_code_url.into(),
            token_url: token_url.into(),
            client_id,
        }
    }

    pub async fn start(&self) -> Result<DeviceStart, DeviceFlowError> {
        if self.client_id.is_empty() {
            return Err(DeviceFlowError::NotConfigured);
        }
        let response = self
            .client
            .post(&self.device_code_url)
            .header("Accept", "application/json")
            .form(&[("client_id", self.client_id)])
            .send()
            .await
            .map_err(|err| DeviceFlowError::Network(err.to_string()))?;
        let body = response
            .text()
            .await
            .map_err(|err| DeviceFlowError::Network(err.to_string()))?;
        let parsed: DeviceStartBody = serde_json::from_str(&body)
            .map_err(|err| DeviceFlowError::UnexpectedResponse(format!("{err}: {body}")))?;
        Ok(DeviceStart {
            device_code: parsed.device_code,
            user_code: parsed.user_code,
            verification_uri: parsed.verification_uri,
            interval: parsed.interval,
            expires_in: parsed.expires_in,
        })
    }

    pub async fn poll_once(&self, device_code: &str) -> Result<PollOutcome, DeviceFlowError> {
        if self.client_id.is_empty() {
            return Err(DeviceFlowError::NotConfigured);
        }
        let response = self
            .client
            .post(&self.token_url)
            .header("Accept", "application/json")
            .form(&[
                ("client_id", self.client_id),
                ("device_code", device_code),
                ("grant_type", GRANT_TYPE),
            ])
            .send()
            .await
            .map_err(|err| DeviceFlowError::Network(err.to_string()))?;
        let body = response
            .text()
            .await
            .map_err(|err| DeviceFlowError::Network(err.to_string()))?;
        parse_poll_response(&body)
    }
}

impl Default for GithubDeviceFlow {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Deserialize)]
struct PollBody {
    access_token: Option<String>,
    error: Option<String>,
    interval: Option<u64>,
}

fn parse_poll_response(body: &str) -> Result<PollOutcome, DeviceFlowError> {
    let parsed: PollBody = serde_json::from_str(body)
        .map_err(|err| DeviceFlowError::UnexpectedResponse(format!("{err}: {body}")))?;
    if let Some(token) = parsed.access_token {
        return Ok(PollOutcome::Connected { token });
    }
    Ok(match parsed.error.as_deref() {
        Some("authorization_pending") => PollOutcome::Pending,
        // GitHub's docs: "5 extra seconds are added to the minimum interval".
        Some("slow_down") => PollOutcome::SlowDown {
            new_interval: parsed.interval.unwrap_or(5) + 5,
        },
        Some("expired_token") => PollOutcome::Expired,
        Some("access_denied") => PollOutcome::Denied,
        Some(other) => PollOutcome::Other(other.to_string()),
        None => PollOutcome::Other("unknown response".to_string()),
    })
}

// PORT STATUS: greenfield (2026-08-19 automations-provider-connections plan, Deliverable 3)
// confidence: high
// todos: 1 (GITHUB_OAUTH_CLIENT_ID left empty until the OAuth App is registered)
// notes: verified live against api.github.com and GitHub's device-flow docs
//        on 2026-08-19 — the error-code table above (authorization_pending,
//        slow_down +5s, expired_token, access_denied) matches the docs
//        verbatim.
