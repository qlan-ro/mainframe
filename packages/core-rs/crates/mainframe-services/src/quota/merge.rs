//! Fold harvested quota into the current snapshot: sparse merges and full replacements.

use mainframe_types::adapter::{ProviderQuota, ProviderQuotaStatus, QuotaWindow};

use super::status::derive_provider_status;

/// A harvested partial update. `None` fields keep the prior value; nothing here
/// ever clears one.
#[derive(Debug, Clone, Default)]
pub struct ProviderQuotaUpdate {
    pub session: Option<QuotaWindow>,
    pub weekly: Option<QuotaWindow>,
    pub model_windows: Option<Vec<QuotaWindow>>,
    pub account_identity: Option<String>,
    pub observed_at: i64,
}

/// Sparse rolling merge: an omitted field keeps whatever the prior blob held.
#[must_use]
pub(crate) fn merge_provider_quota(
    prior: Option<&ProviderQuota>,
    update: ProviderQuotaUpdate,
    now: i64,
) -> ProviderQuota {
    let mut merged = ProviderQuota {
        status: ProviderQuotaStatus::Unknown,
        session: update
            .session
            .or_else(|| prior.and_then(|p| p.session.clone())),
        weekly: update
            .weekly
            .or_else(|| prior.and_then(|p| p.weekly.clone())),
        model_windows: merge_model_windows(
            prior.map(|p| p.model_windows.as_slice()),
            update.model_windows,
        ),
        observed_at: update.observed_at,
        account_identity: update
            .account_identity
            .or_else(|| prior.and_then(|p| p.account_identity.clone())),
    };
    merged.status = derive_provider_status(&merged, now);
    merged
}

/// Upsert incoming model windows onto the prior set by label (#268 F3): each
/// incoming entry replaces its same-label prior (or appends when new), while labels
/// absent from the incoming set keep their prior entry — expiry, not the merge,
/// removes stale model windows. An omitted (`None`) incoming set keeps prior whole.
fn merge_model_windows(
    prior: Option<&[QuotaWindow]>,
    incoming: Option<Vec<QuotaWindow>>,
) -> Vec<QuotaWindow> {
    let mut merged: Vec<QuotaWindow> = prior.map(<[QuotaWindow]>::to_vec).unwrap_or_default();
    let Some(incoming) = incoming else {
        return merged;
    };
    for window in incoming {
        match merged.iter_mut().find(|w| w.label == window.label) {
            Some(existing) => *existing = window,
            None => merged.push(window),
        }
    }
    merged
}

/// A full replacement: take exactly the harvested windows, re-deriving status.
#[must_use]
pub(crate) fn replace_blob(
    quota: &ProviderQuota,
    identity: Option<String>,
    now: i64,
) -> ProviderQuota {
    let mut blob = ProviderQuota {
        status: ProviderQuotaStatus::Unknown,
        session: quota.session.clone(),
        weekly: quota.weekly.clone(),
        model_windows: quota.model_windows.clone(),
        observed_at: quota.observed_at,
        account_identity: identity,
    };
    blob.status = derive_provider_status(&blob, now);
    blob
}

/// An empty `model_windows` is dropped so a push can't clear the prior model windows.
#[must_use]
pub(crate) fn to_sparse_update(
    quota: &ProviderQuota,
    identity: Option<String>,
) -> ProviderQuotaUpdate {
    ProviderQuotaUpdate {
        observed_at: quota.observed_at,
        account_identity: identity,
        session: quota.session.clone(),
        weekly: quota.weekly.clone(),
        model_windows: if quota.model_windows.is_empty() {
            None
        } else {
            Some(quota.model_windows.clone())
        },
    }
}

#[cfg(test)]
#[path = "merge_tests.rs"]
mod tests;
