use super::*;

pub(super) fn known_quota(
    now: i64,
    session: Option<QuotaWindow>,
    weekly: Option<QuotaWindow>,
    model_windows: Vec<QuotaWindow>,
) -> ProviderQuota {
    ProviderQuota {
        status: ProviderQuotaStatus::Ok,
        observed_at: now,
        session,
        weekly,
        model_windows,
        account_identity: None,
    }
}
