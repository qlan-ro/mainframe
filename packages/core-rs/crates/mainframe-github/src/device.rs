//! GitHub App device flow. Device flow needs no client secret, neither for the
//! token exchange nor for refresh: GitHub's refresh-token docs mark
//! `client_secret` "required unless the user access token was generated using
//! the device flow". That is why `GITHUB_APP_CLIENT_ID` is the only identifier
//! the binary ships, and why moving token generation off device flow would
//! make refresh need a secret.
//!
//! `poll_once` makes one request; the caller owns the polling interval.

use reqwest::StatusCode;
use serde::Deserialize;

use crate::rest::{REQUEST_TIMEOUT, client_builder};

/// The registered GitHub App's client ID. Public by design: it identifies the
/// app on GitHub's consent screen. Empty disables device flow, and the editor
/// offers only the pasted-token field.
pub const GITHUB_APP_CLIENT_ID: &str = "Iv23liJciR5mmjd0cFYE";

const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
/// Also the refresh-token endpoint.
pub const TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:device_code";

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct DeviceStart {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub interval: u64,
    pub expires_in: u64,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum DeviceFlowError {
    #[error("GitHub connection isn't set up yet — no GitHub App client ID is configured")]
    NotConfigured,
    #[error("GitHub device flow request failed: {0}")]
    Network(String),
    /// GitHub answered with an OAuth error, such as `device_flow_disabled`.
    #[error("GitHub refused the device flow request: {0}")]
    Rejected(String),
    #[error("GitHub device flow request failed: unexpected response ({0})")]
    UnexpectedResponse(String),
}

/// The outcome of one poll against the token endpoint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PollOutcome {
    Connected {
        token: String,
        /// Seconds until the token expires. GitHub App user tokens carry it;
        /// OAuth App tokens never expire and omit it.
        expires_in: Option<u64>,
        /// Absent means the credential cannot be refreshed.
        refresh_token: Option<String>,
    },
    /// The user hasn't entered the code yet; keep polling.
    Pending,
    /// Polling too fast; wait `new_interval` seconds between polls from now on.
    SlowDown { new_interval: u64 },
    /// The device code expired; start over.
    Expired,
    /// The user cancelled.
    Denied,
    /// Any other OAuth error code, verbatim.
    Other(String),
}

pub struct GithubDeviceFlow {
    client: reqwest::Client,
    device_code_url: String,
    token_url: String,
    client_id: &'static str,
}

impl GithubDeviceFlow {
    pub fn new() -> Result<Self, DeviceFlowError> {
        Self::with_urls(DEVICE_CODE_URL, TOKEN_URL, GITHUB_APP_CLIENT_ID)
    }

    pub fn with_urls(
        device_code_url: impl Into<String>,
        token_url: impl Into<String>,
        client_id: &'static str,
    ) -> Result<Self, DeviceFlowError> {
        let client = client_builder().build().map_err(network)?;
        Ok(Self {
            client,
            device_code_url: device_code_url.into(),
            token_url: token_url.into(),
            client_id,
        })
    }

    pub async fn start(&self) -> Result<DeviceStart, DeviceFlowError> {
        let (status, body) = self
            .post(&self.device_code_url, &[("client_id", self.client_id)])
            .await?;
        // RFC 8628 §3.2: the device authorization endpoint reports errors in
        // the RFC 6749 §5.2 shape.
        if let Ok(rejection) = serde_json::from_str::<OAuthError>(&body) {
            return Err(DeviceFlowError::Rejected(rejection.message()));
        }
        serde_json::from_str(&body).map_err(|err| unexpected(status, &err))
    }

    pub async fn poll_once(&self, device_code: &str) -> Result<PollOutcome, DeviceFlowError> {
        let (status, body) = self
            .post(
                &self.token_url,
                &[
                    ("client_id", self.client_id),
                    ("device_code", device_code),
                    ("grant_type", GRANT_TYPE),
                ],
            )
            .await?;
        let parsed: PollBody =
            serde_json::from_str(&body).map_err(|err| unexpected(status, &err))?;
        Ok(parsed.into_outcome())
    }

    async fn post(
        &self,
        url: &str,
        form: &[(&str, &str)],
    ) -> Result<(StatusCode, String), DeviceFlowError> {
        if self.client_id.is_empty() {
            return Err(DeviceFlowError::NotConfigured);
        }
        let response = self
            .client
            .post(url)
            .header("Accept", "application/json")
            .timeout(REQUEST_TIMEOUT)
            .form(form)
            .send()
            .await
            .map_err(network)?;
        let status = response.status();
        let body = response.text().await.map_err(network)?;
        Ok((status, body))
    }
}

fn network(err: reqwest::Error) -> DeviceFlowError {
    DeviceFlowError::Network(err.to_string())
}

/// Names the status and the decode error but never quotes the body, which
/// can carry a device code or an access token.
fn unexpected(status: StatusCode, err: &serde_json::Error) -> DeviceFlowError {
    DeviceFlowError::UnexpectedResponse(format!("HTTP {}: {err}", status.as_u16()))
}

#[derive(Deserialize)]
struct OAuthError {
    error: String,
    error_description: Option<String>,
}

impl OAuthError {
    fn message(self) -> String {
        self.error_description.unwrap_or(self.error)
    }
}

#[derive(Deserialize)]
struct PollBody {
    access_token: Option<String>,
    error: Option<String>,
    interval: Option<u64>,
    expires_in: Option<u64>,
    refresh_token: Option<String>,
}

impl PollBody {
    fn into_outcome(self) -> PollOutcome {
        if let Some(token) = self.access_token {
            return PollOutcome::Connected {
                token,
                expires_in: self.expires_in,
                refresh_token: self.refresh_token,
            };
        }
        match self.error.as_deref() {
            Some("authorization_pending") => PollOutcome::Pending,
            // GitHub's docs: "5 extra seconds are added to the minimum interval".
            Some("slow_down") => PollOutcome::SlowDown {
                new_interval: self.interval.unwrap_or(5) + 5,
            },
            Some("expired_token") => PollOutcome::Expired,
            Some("access_denied") => PollOutcome::Denied,
            Some(other) => PollOutcome::Other(other.to_string()),
            None => PollOutcome::Other("unknown response".to_string()),
        }
    }
}

#[cfg(test)]
#[path = "device_tests.rs"]
mod tests;
