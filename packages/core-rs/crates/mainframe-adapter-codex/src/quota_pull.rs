//! Harvests Codex's plan quota: pulls `account/rateLimits/read`, normalizes its
//! windows, and stamps the resolved account identity. Rate limits and identity
//! are read concurrently over the same connection — the caller (manual-refresh
//! puller) owns spawning/closing the app-server, never spawning purely to poll.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use mainframe_adapter_api::AdapterError;
use mainframe_types::adapter::ProviderQuota;

use crate::quota_identity::{
    ReadAccount, ReadCodexAccountIdentityDeps, read_codex_account_identity,
};
use crate::quota_rate_limit::normalize_rate_limit_snapshot;
use crate::session::spawn_temp_app_server;
use crate::types::{GetAccountRateLimitsResult, GetAccountResult};

type RunRateLimits = dyn Fn() -> Pin<Box<dyn Future<Output = Result<GetAccountRateLimitsResult, AdapterError>> + Send>>
    + Send
    + Sync;

/// Injected dependencies so tests need no real app-server connection.
pub struct PullCodexQuotaDeps<'a> {
    /// `account/rateLimits/read` over a live (or freshly spawned) app-server connection.
    pub run_rate_limits: &'a RunRateLimits,
    /// `account/read` over the same connection.
    pub read_account: &'a ReadAccount,
    pub now: i64,
}

pub(crate) async fn pull_codex_quota(
    deps: PullCodexQuotaDeps<'_>,
) -> Result<ProviderQuota, AdapterError> {
    let (result, account_identity) = tokio::join!(
        (deps.run_rate_limits)(),
        read_codex_account_identity(ReadCodexAccountIdentityDeps {
            read_account: deps.read_account,
            read_auth_file: None
        })
    );
    let result = result?;
    let mut quota = normalize_rate_limit_snapshot(&result.rate_limits, deps.now);
    quota.account_identity = Some(account_identity);
    Ok(quota)
}

/// Default connection: spawn one temp app-server, issue `account/rateLimits/read` and
/// `account/read` back-to-back, then close it. Used by the puller on boot warm-up and
/// manual refresh only — never wired to a scheduler (Codex has no timer-based polling,
/// unlike Claude).
pub async fn pull_codex_quota_via_temp_app_server(
    executable: &str,
    path: &str,
) -> Result<ProviderQuota, AdapterError> {
    let client = spawn_temp_app_server(executable, None, false, path).await?;

    let run_rate_limits: Box<RunRateLimits> = {
        let client = Arc::clone(&client);
        Box::new(move || {
            let client = Arc::clone(&client);
            Box::pin(async move {
                let value = client
                    .request("account/rateLimits/read", None)
                    .await
                    .map_err(AdapterError::from)?;
                serde_json::from_value(value).map_err(AdapterError::from)
            })
        })
    };
    let read_account: Box<ReadAccount> = {
        let client = Arc::clone(&client);
        Box::new(move || {
            let client = Arc::clone(&client);
            Box::pin(async move {
                let value = client
                    .request("account/read", None)
                    .await
                    .map_err(AdapterError::from)?;
                let result: GetAccountResult =
                    serde_json::from_value(value).map_err(AdapterError::from)?;
                Ok(result.account)
            })
        })
    };

    let result = pull_codex_quota(PullCodexQuotaDeps {
        run_rate_limits: &run_rate_limits,
        read_account: &read_account,
        now: mainframe_types::time::now_ms(),
    })
    .await;
    client.close();
    result
}

#[cfg(test)]
#[path = "quota_pull_tests.rs"]
mod tests;
