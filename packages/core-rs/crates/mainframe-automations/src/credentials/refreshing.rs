//! Token refresh for GitHub-App-issued credentials (2026-08-19
//! GitHub-App-with-refresh plan). GitHub App user tokens expire after 8h; a
//! pasted PAT (or a plain OAuth App token) never carries `expires_at` and is
//! passed through untouched — see `github_device.rs`'s module doc for why
//! `client_id` alone is enough to refresh (device flow needs no secret).
//!
//! A per-label lock is mandatory, not an optimization: GitHub invalidates
//! the old refresh token the moment a new one is issued, so two concurrent
//! refreshes for the same label (e.g. a `repeat` block with `concurrency`
//! running GitHub steps) would have the loser present an already-dead
//! refresh token and log the user out. Every `get()` for a label queues
//! behind the same lock and re-checks expiry after acquiring it, so a
//! stampede produces exactly one live refresh call.

use std::collections::HashMap;
use std::sync::Arc;

use serde::Deserialize;
use tokio::sync::Mutex;

use crate::USER_AGENT;
use crate::github_device::{GITHUB_APP_CLIENT_ID, TOKEN_URL};
use crate::ports::Clock;

use super::{CredentialError, CredentialStore, Credentials};

/// Refresh once expiry is within 5 minutes — comfortably inside the 8h user
/// token lifetime, so a step never races the deadline mid-run.
const REFRESH_SKEW_MS: i64 = 5 * 60 * 1000;

pub struct RefreshingCredentialStore {
    inner: Arc<dyn CredentialStore>,
    clock: Arc<dyn Clock>,
    client: reqwest::Client,
    token_url: String,
    client_id: &'static str,
    label_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl RefreshingCredentialStore {
    pub fn new(inner: Arc<dyn CredentialStore>, clock: Arc<dyn Clock>) -> Self {
        Self::with_token_url(inner, clock, TOKEN_URL.to_string(), GITHUB_APP_CLIENT_ID)
    }

    pub fn with_token_url(
        inner: Arc<dyn CredentialStore>,
        clock: Arc<dyn Clock>,
        token_url: String,
        client_id: &'static str,
    ) -> Self {
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            inner,
            clock,
            client,
            token_url,
            client_id,
            label_locks: Mutex::new(HashMap::new()),
        }
    }

    /// Refreshes and persists an expiring credential before returning it. A
    /// PAT (no `refresh_token`/`expires_at`) passes through unchanged.
    pub async fn get(&self, label: &str) -> Result<Option<Credentials>, CredentialError> {
        let Some(creds) = self.inner.get(label).await else {
            return Ok(None);
        };
        if !self.needs_refresh(&creds) {
            return Ok(Some(creds));
        }

        let lock = self.label_lock(label).await;
        let _guard = lock.lock().await;

        // Re-read under the lock: a concurrent waiter may already have
        // refreshed and persisted while this call queued behind it.
        let Some(creds) = self.inner.get(label).await else {
            return Ok(None);
        };
        if !self.needs_refresh(&creds) {
            return Ok(Some(creds));
        }

        let refreshed = self.refresh(label, &creds).await?;
        self.inner.set(label, refreshed.clone()).await?;
        Ok(Some(refreshed))
    }

    fn needs_refresh(&self, creds: &Credentials) -> bool {
        let (Some(_), Some(expires_at)) = (&creds.refresh_token, creds.expires_at) else {
            return false;
        };
        expires_at - self.clock.now().timestamp_millis() <= REFRESH_SKEW_MS
    }

    async fn label_lock(&self, label: &str) -> Arc<Mutex<()>> {
        let mut locks = self.label_locks.lock().await;
        locks
            .entry(label.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    async fn refresh(
        &self,
        label: &str,
        creds: &Credentials,
    ) -> Result<Credentials, CredentialError> {
        if self.client_id.is_empty() {
            return Err(refresh_failed(
                label,
                "no GitHub App client ID is configured",
            ));
        }
        let refresh_token = creds.refresh_token.as_deref().unwrap_or_default();
        let response = self
            .client
            .post(&self.token_url)
            .header("Accept", "application/json")
            .form(&[
                ("client_id", self.client_id),
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token),
            ])
            .send()
            .await
            .map_err(|err| refresh_failed(label, &err.to_string()))?;
        let body = response
            .text()
            .await
            .map_err(|err| refresh_failed(label, &err.to_string()))?;
        let parsed: RefreshBody = serde_json::from_str(&body)
            .map_err(|err| refresh_failed(label, &format!("unexpected response ({err})")))?;
        let Some(access_token) = parsed.access_token else {
            let reason = parsed
                .error_description
                .or(parsed.error)
                .unwrap_or_else(|| "no access token in response".to_string());
            return Err(refresh_failed(label, &reason));
        };
        let expires_at = parsed
            .expires_in
            .map(|secs| self.clock.now().timestamp_millis() + secs as i64 * 1000);
        Ok(Credentials {
            kind: creds.kind,
            token: access_token,
            extra: creds.extra.clone(),
            refresh_token: parsed.refresh_token.or_else(|| creds.refresh_token.clone()),
            expires_at,
        })
    }
}

#[derive(Debug, Deserialize)]
struct RefreshBody {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    error: Option<String>,
    error_description: Option<String>,
}

fn refresh_failed(label: &str, reason: &str) -> CredentialError {
    CredentialError::RefreshFailed {
        label: label.to_string(),
        reason: reason.to_string(),
    }
}

// PORT STATUS: greenfield (2026-08-19 GitHub-App-with-refresh plan), not a TS port
// confidence: high
// todos: 0
// notes: sits above CredentialStore rather than implementing it — only
//        RunActionVerb (the execution path) needs refresh; the admin/UI
//        accessor and webhook secret lookups keep reading the raw store.
