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
async fn normalizes_the_injected_rate_limit_snapshot_and_stamps_the_resolved_account_identity() {
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
