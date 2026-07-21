//! Ported from `packages/core/src/plugins/builtin/codex/quota-pull.ts`.
//!
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

pub async fn pull_codex_quota(deps: PullCodexQuotaDeps<'_>) -> Result<ProviderQuota, AdapterError> {
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
                    .map_err(|err| AdapterError::Message(err.0))?;
                serde_json::from_value(value).map_err(|err| AdapterError::Message(err.to_string()))
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
                    .map_err(|err| AdapterError::Message(err.0))?;
                let result: GetAccountResult = serde_json::from_value(value)
                    .map_err(|err| AdapterError::Message(err.to_string()))?;
                Ok(result.account)
            })
        })
    };

    let result = pull_codex_quota(PullCodexQuotaDeps {
        run_rate_limits: &run_rate_limits,
        read_account: &read_account,
        now: chrono::Utc::now().timestamp_millis(),
    })
    .await;
    client.close();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::RateLimitSnapshot;
    use mainframe_types::adapter::ProviderQuotaStatus;

    const NOW: i64 = 1_752_818_400_000; // 2026-07-18T06:00:00Z

    fn run_rate_limits_ok(snapshot: RateLimitSnapshot) -> Box<RunRateLimits> {
        Box::new(move || {
            let snapshot = snapshot.clone();
            Box::pin(async move {
                Ok(GetAccountRateLimitsResult {
                    rate_limits: snapshot,
                })
            })
        })
    }
    fn read_account_ok(account: crate::types::Account) -> Box<ReadAccount> {
        Box::new(move || {
            let account = account.clone();
            Box::pin(async move { Ok(Some(account)) })
        })
    }
    fn read_account_err() -> Box<ReadAccount> {
        Box::new(|| Box::pin(async { Err(AdapterError::Message("app-server unreachable".into())) }))
    }

    #[tokio::test]
    async fn normalizes_the_injected_rate_limit_snapshot_and_stamps_the_resolved_account_identity()
    {
        let run_rate_limits = run_rate_limits_ok(RateLimitSnapshot {
            limit_id: Some("codex".into()),
            limit_name: None,
            primary: Some(crate::types::RateLimitWindow {
                used_percent: 41.0,
                window_duration_mins: Some(300),
                resets_at: Some(1_784_800_000),
            }),
            secondary: Some(crate::types::RateLimitWindow {
                used_percent: 12.0,
                window_duration_mins: Some(10080),
                resets_at: Some(1_784_845_911),
            }),
        });
        let read_account = read_account_ok(crate::types::Account::Chatgpt {
            email: Some("a@b.com".into()),
            plan_type: Some("plus".into()),
        });

        let quota = pull_codex_quota(PullCodexQuotaDeps {
            run_rate_limits: &run_rate_limits,
            read_account: &read_account,
            now: NOW,
        })
        .await
        .unwrap();

        assert_eq!(quota.status, ProviderQuotaStatus::Ok);
        let session = quota.session.unwrap();
        assert_eq!(session.used_percent, 41.0);
        assert_eq!(session.resets_at, Some(1_784_800_000_000));
        let weekly = quota.weekly.unwrap();
        assert_eq!(weekly.used_percent, 12.0);
        assert_eq!(weekly.resets_at, Some(1_784_845_911_000));
        assert_eq!(quota.account_identity.as_deref(), Some("a@b.com"));
        assert_eq!(quota.observed_at, NOW);
    }

    #[tokio::test]
    async fn stamps_the_transient_identity_sentinel_when_account_read_fails_without_failing_the_whole_pull()
     {
        let run_rate_limits = run_rate_limits_ok(RateLimitSnapshot {
            limit_id: Some("codex".into()),
            limit_name: None,
            primary: None,
            secondary: None,
        });
        let read_account = read_account_err();

        let quota = pull_codex_quota(PullCodexQuotaDeps {
            run_rate_limits: &run_rate_limits,
            read_account: &read_account,
            now: NOW,
        })
        .await
        .unwrap();

        assert_eq!(quota.status, ProviderQuotaStatus::Ok);
        assert_eq!(
            quota.account_identity.as_deref(),
            Some("transient:identity-read-failed")
        );
    }
}

// PORT STATUS: src/plugins/builtin/codex/quota-pull.ts (47 lines)
// confidence: high
// todos: 0
// notes: runRateLimits/readAccount are injected as boxed async closures (Rust has
// notes: no bare async-fn-value equivalent), mirroring the Claude quota_pull seam.
// notes: pull_codex_quota_via_temp_app_server takes an explicit `path` param (the
// notes: TS spawnTempAppServer inherits process.env directly; Rust's
// notes: spawn_temp_app_server requires PATH threaded explicitly per the crate's
// notes: edition-2024 no-env-mutation convention). client.close() runs after the
// notes: pull unconditionally (Rust has no try/finally) via a stored Result.
