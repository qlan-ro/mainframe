//! Retain the last known quota after a pull failure.

use mainframe_types::adapter::{ProviderQuota, ProviderQuotaStatus};

use super::status::derive_provider_status;

/// An empty `unknown` blob stamped with the given clock.
#[must_use]
pub(crate) fn unknown_provider_quota(now: i64) -> ProviderQuota {
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
pub(crate) fn handle_pull_failure(prior: Option<&ProviderQuota>, now: i64) -> ProviderQuota {
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
#[path = "backoff_tests.rs"]
mod tests;
