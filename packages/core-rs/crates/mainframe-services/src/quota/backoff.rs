//! Ported from `src/quota/backoff.ts` — keep-last-known on a pull failure.

use mainframe_types::adapter::{ProviderQuota, ProviderQuotaStatus};

use super::status::derive_provider_status;

/// An empty `unknown` blob stamped with the given clock.
#[must_use]
pub fn unknown_provider_quota(now: i64) -> ProviderQuota {
    ProviderQuota {
        status: ProviderQuotaStatus::Unknown,
        session: None,
        weekly: None,
        model_windows: vec![],
        observed_at: now,
        account_identity: None,
    }
}

/// On a pull failure, keep the last-known blob and let expiry/staleness rules —
/// not the failure itself — decide whether the provider still reads as
/// trustworthy.
#[must_use]
pub fn handle_pull_failure(prior: Option<&ProviderQuota>, now: i64) -> ProviderQuota {
    match prior {
        None => unknown_provider_quota(now),
        Some(prior) => {
            let mut blob = prior.clone();
            blob.status = derive_provider_status(prior, now);
            blob
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mainframe_types::adapter::{QuotaWindow, QuotaWindowKind};

    const NOW: i64 = 1_720_000_000_000;

    fn session(used_percent: f64, resets_at: i64) -> QuotaWindow {
        QuotaWindow {
            kind: QuotaWindowKind::Session,
            used_percent,
            resets_at: Some(resets_at),
            observed_at: None,
            label: None,
        }
    }

    #[test]
    fn unknown_blob_is_empty_and_stamped() {
        assert_eq!(
            unknown_provider_quota(NOW),
            ProviderQuota {
                status: ProviderQuotaStatus::Unknown,
                session: None,
                weekly: None,
                model_windows: vec![],
                observed_at: NOW,
                account_identity: None,
            }
        );
    }

    #[test]
    fn returns_unknown_when_no_last_known_state() {
        assert_eq!(handle_pull_failure(None, NOW), unknown_provider_quota(NOW));
    }

    #[test]
    fn keeps_last_known_windows_and_stays_ok_while_trusted() {
        let win = session(40.0, NOW + 10_000);
        let prior = ProviderQuota {
            status: ProviderQuotaStatus::Ok,
            session: Some(win.clone()),
            weekly: None,
            model_windows: vec![],
            observed_at: NOW - 5_000,
            account_identity: None,
        };

        let result = handle_pull_failure(Some(&prior), NOW);

        assert_eq!(result.status, ProviderQuotaStatus::Ok);
        assert_eq!(result.session, Some(win));
        assert_eq!(result.observed_at, NOW - 5_000);
    }

    #[test]
    fn fails_closed_once_last_known_windows_expire_without_wiping_data() {
        let win = session(40.0, NOW - 1);
        let prior = ProviderQuota {
            status: ProviderQuotaStatus::Ok,
            session: Some(win.clone()),
            weekly: None,
            model_windows: vec![],
            observed_at: NOW - 5_000,
            account_identity: None,
        };

        let result = handle_pull_failure(Some(&prior), NOW);

        assert_eq!(result.status, ProviderQuotaStatus::Unknown);
        assert_eq!(result.session, Some(win));
    }
}
