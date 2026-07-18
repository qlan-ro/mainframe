//! Ported from `src/quota/merge.ts` — the sparse rolling merge.

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
pub fn merge_provider_quota(
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
        model_windows: update
            .model_windows
            .or_else(|| prior.map(|p| p.model_windows.clone()))
            .unwrap_or_default(),
        observed_at: update.observed_at,
        account_identity: update
            .account_identity
            .or_else(|| prior.and_then(|p| p.account_identity.clone())),
    };
    merged.status = derive_provider_status(&merged, now);
    merged
}

#[cfg(test)]
mod tests {
    use super::*;
    use mainframe_types::adapter::QuotaWindowKind;

    const NOW: i64 = 1_720_000_000_000;

    fn win(kind: QuotaWindowKind, used_percent: f64, resets_at: i64, label: Option<&str>) -> QuotaWindow {
        QuotaWindow {
            kind,
            used_percent,
            resets_at: Some(resets_at),
            label: label.map(str::to_string),
        }
    }

    #[test]
    fn keeps_prior_session_when_update_omits_it() {
        let session = win(QuotaWindowKind::Session, 10.0, NOW + 10_000, None);
        let weekly = win(QuotaWindowKind::Weekly, 20.0, NOW + 10_000, None);
        let prior = ProviderQuota {
            status: ProviderQuotaStatus::Ok,
            session: Some(session.clone()),
            weekly: Some(weekly),
            model_windows: vec![],
            observed_at: NOW - 1_000,
            account_identity: None,
        };
        let new_weekly = win(QuotaWindowKind::Weekly, 25.0, NOW + 20_000, None);

        let merged = merge_provider_quota(
            Some(&prior),
            ProviderQuotaUpdate {
                weekly: Some(new_weekly.clone()),
                observed_at: NOW,
                ..Default::default()
            },
            NOW,
        );

        assert_eq!(merged.session, Some(session));
        assert_eq!(merged.weekly, Some(new_weekly));
    }

    #[test]
    fn keeps_prior_model_windows_when_update_omits_them() {
        let model = win(QuotaWindowKind::WeeklyModel, 30.0, NOW + 10_000, Some("opus"));
        let prior = ProviderQuota {
            status: ProviderQuotaStatus::Ok,
            session: None,
            weekly: None,
            model_windows: vec![model.clone()],
            observed_at: NOW - 1_000,
            account_identity: None,
        };

        let merged = merge_provider_quota(
            Some(&prior),
            ProviderQuotaUpdate {
                observed_at: NOW,
                ..Default::default()
            },
            NOW,
        );

        assert_eq!(merged.model_windows, vec![model]);
    }

    #[test]
    fn starts_from_empty_blob_when_no_prior_state() {
        let session = win(QuotaWindowKind::Session, 5.0, NOW + 10_000, None);

        let merged = merge_provider_quota(
            None,
            ProviderQuotaUpdate {
                session: Some(session.clone()),
                observed_at: NOW,
                ..Default::default()
            },
            NOW,
        );

        assert_eq!(
            merged,
            ProviderQuota {
                status: ProviderQuotaStatus::Ok,
                session: Some(session),
                weekly: None,
                model_windows: vec![],
                observed_at: NOW,
                account_identity: None,
            }
        );
    }

    #[test]
    fn keeps_prior_account_identity_when_update_omits_it() {
        let prior = ProviderQuota {
            status: ProviderQuotaStatus::Ok,
            session: None,
            weekly: None,
            model_windows: vec![],
            observed_at: NOW - 1_000,
            account_identity: Some("user-a".into()),
        };

        let merged = merge_provider_quota(
            Some(&prior),
            ProviderQuotaUpdate {
                observed_at: NOW,
                ..Default::default()
            },
            NOW,
        );

        assert_eq!(merged.account_identity, Some("user-a".into()));
    }

    #[test]
    fn overwrites_account_identity_when_update_provides_new_one() {
        let prior = ProviderQuota {
            status: ProviderQuotaStatus::Ok,
            session: None,
            weekly: None,
            model_windows: vec![],
            observed_at: NOW - 1_000,
            account_identity: Some("user-a".into()),
        };

        let merged = merge_provider_quota(
            Some(&prior),
            ProviderQuotaUpdate {
                account_identity: Some("user-b".into()),
                observed_at: NOW,
                ..Default::default()
            },
            NOW,
        );

        assert_eq!(merged.account_identity, Some("user-b".into()));
    }

    #[test]
    fn recomputes_status_unknown_when_merged_windows_all_expired() {
        let session = win(QuotaWindowKind::Session, 10.0, NOW - 1, None);
        let prior = ProviderQuota {
            status: ProviderQuotaStatus::Ok,
            session: Some(session),
            weekly: None,
            model_windows: vec![],
            observed_at: NOW - 1_000,
            account_identity: None,
        };

        let merged = merge_provider_quota(
            Some(&prior),
            ProviderQuotaUpdate {
                observed_at: NOW,
                ..Default::default()
            },
            NOW,
        );

        assert_eq!(merged.status, ProviderQuotaStatus::Unknown);
    }
}
