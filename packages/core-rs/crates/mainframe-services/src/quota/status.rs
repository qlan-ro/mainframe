//! Derive provider status, failing closed when quota data is missing.

use mainframe_types::adapter::{ProviderQuota, ProviderQuotaStatus};

use super::window_lifecycle::{collect_quota_windows, is_window_trusted};

/// Fail-closed (#251): a single untrusted window is fine, but zero trusted
/// windows fails the whole provider to `unknown`.
#[must_use]
pub(crate) fn derive_provider_status(quota: &ProviderQuota, now: i64) -> ProviderQuotaStatus {
    let has_trusted = collect_quota_windows(quota)
        .iter()
        .any(|window| is_window_trusted(window, quota.observed_at, now));
    if has_trusted {
        ProviderQuotaStatus::Ok
    } else {
        ProviderQuotaStatus::Unknown
    }
}

#[cfg(test)]
#[path = "status_tests.rs"]
mod tests;
