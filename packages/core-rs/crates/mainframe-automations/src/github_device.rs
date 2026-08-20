//! GitHub App device flow (2026-08-19 provider-connections plan, Deliverable
//! 3; reversed from OAuth App to GitHub App for token refresh — 2026-08-19
//! GitHub-App-with-refresh plan). Device flow's token exchange needs only
//! `client_id`, `device_code`, and `grant_type`; GitHub's docs state the
//! client secret is "not needed for the device flow". No redirect URI, no
//! PKCE, no `state` — none of that applies to a flow that never redirects.
//!
//! **Load-bearing fact:** GitHub's refresh-token docs list `client_secret`
//! as "Required unless the user access token was generated using the device
//! flow." Because token generation here IS device flow, `credentials::
//! refreshing` can refresh with `client_id` alone — no secret ships in the
//! binary. Moving token generation off device flow would make refresh start
//! requiring a secret, and the no-secret design collapses.
//!
//! `GITHUB_APP_CLIENT_ID` is the single place the registered GitHub App's
//! client ID goes once it exists; empty means "not configured yet" and
//! `start()` reports that explicitly rather than making a doomed request.
//!
//! `poll_once` makes exactly one probe against GitHub's token endpoint and
//! maps the response to a `PollOutcome` — it does not loop or sleep itself.
//! The caller (the daemon route) drives the interval; `SlowDown` carries the
//! new interval GitHub asked for, per the docs' "5 extra seconds" rule. A
//! GitHub App's response additionally carries `expires_in`/`refresh_token`
//! (a plain OAuth App's does not) — `Connected` carries both as optional so
//! the route can persist them without this module caring which app kind is
//! configured.

use serde::Deserialize;

use crate::USER_AGENT;

/// The registered GitHub App's client ID. Public by design — it ships in the
/// binary and identifies the app on GitHub's consent screen; the secret it is
/// paired with never leaves GitHub, because device flow does not use one.
/// Empty = device flow is unavailable and the editor falls back to the token
/// field.
pub const GITHUB_APP_CLIENT_ID: &str = "Iv23liJciR5mmjd0cFYE";

const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
/// Also the refresh-token endpoint (`credentials::refreshing`) — GitHub
/// reuses one token endpoint for both the initial exchange and refresh.
pub(crate) const TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
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
    #[error("GitHub connection isn't set up yet — no GitHub App client ID is configured")]
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
        /// Seconds until the token expires — set for a GitHub App user
        /// token (8h), absent for a plain OAuth App token (never expires).
        expires_in: Option<u64>,
        /// Present alongside `expires_in` on a GitHub App token; absent
        /// means the caller must not attempt to refresh this credential.
        refresh_token: Option<String>,
    },
    /// The user hasn't entered the code yet — keep polling at `interval`.
    Pending,
    /// Poll faster than allowed; wait `new_interval` seconds from now on.
    SlowDown { new_interval: u64 },
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
        Self::with_urls(DEVICE_CODE_URL, TOKEN_URL, GITHUB_APP_CLIENT_ID)
    }

    /// Whether a GitHub App client ID is registered — the UI's signal for
    /// whether to offer sign-in-with-GitHub alongside the always-available
    /// pasted-token path (`GithubCredentialConnect.tsx`).
    pub fn is_configured(&self) -> bool {
        !self.client_id.is_empty()
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
    expires_in: Option<u64>,
    refresh_token: Option<String>,
}

fn parse_poll_response(body: &str) -> Result<PollOutcome, DeviceFlowError> {
    let parsed: PollBody = serde_json::from_str(body)
        .map_err(|err| DeviceFlowError::UnexpectedResponse(format!("{err}: {body}")))?;
    if let Some(token) = parsed.access_token {
        return Ok(PollOutcome::Connected {
            token,
            expires_in: parsed.expires_in,
            refresh_token: parsed.refresh_token,
        });
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
