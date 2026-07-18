//! Ported from `src/quota/tightest-window.ts` — the single collapsed-row number.

use mainframe_types::adapter::{ProviderQuota, QuotaWindow};

use super::window_lifecycle::{collect_quota_windows, is_window_trusted};

/// The single number that will actually stop the user: the max `usedPercent`
/// among trusted windows. Ties keep the earlier window in session/weekly/model
/// order (the `reduce` only replaces on a strictly greater percent).
#[must_use]
pub fn select_tightest_window(quota: &ProviderQuota, now: i64) -> Option<&QuotaWindow> {
    collect_quota_windows(quota)
        .into_iter()
        .filter(|window| is_window_trusted(window, quota.observed_at, now))
        .reduce(|tightest, window| {
            if window.used_percent > tightest.used_percent {
                window
            } else {
                tightest
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use mainframe_types::adapter::{ProviderQuotaStatus, QuotaWindowKind};

    const NOW: i64 = 1_720_000_000_000;

    fn win(kind: QuotaWindowKind, used_percent: f64, resets_at: i64, label: Option<&str>) -> QuotaWindow {
        QuotaWindow {
            kind,
            used_percent,
            resets_at: Some(resets_at),
            observed_at: None,
            label: label.map(str::to_string),
        }
    }

    fn quota(session: Option<QuotaWindow>, weekly: Option<QuotaWindow>, model: Vec<QuotaWindow>) -> ProviderQuota {
        ProviderQuota {
            status: ProviderQuotaStatus::Ok,
            session,
            weekly,
            model_windows: model,
            observed_at: NOW,
            account_identity: None,
        }
    }

    #[test]
    fn picks_highest_used_percent_among_trusted() {
        let session = win(QuotaWindowKind::Session, 40.0, NOW + 10_000, None);
        let weekly = win(QuotaWindowKind::Weekly, 75.0, NOW + 10_000, None);
        let q = quota(Some(session), Some(weekly.clone()), vec![]);
        assert_eq!(select_tightest_window(&q, NOW), Some(&weekly));
    }

    #[test]
    fn ignores_expired_windows_even_when_higher() {
        let session = win(QuotaWindowKind::Session, 90.0, NOW + 10_000, None);
        let weekly = win(QuotaWindowKind::Weekly, 95.0, NOW - 1, None);
        let q = quota(Some(session.clone()), Some(weekly), vec![]);
        assert_eq!(select_tightest_window(&q, NOW), Some(&session));
    }

    #[test]
    fn returns_none_when_every_window_expired() {
        let session = win(QuotaWindowKind::Session, 90.0, NOW - 1, None);
        let q = quota(Some(session), None, vec![]);
        assert_eq!(select_tightest_window(&q, NOW), None);
    }

    #[test]
    fn considers_model_windows_alongside_session_and_weekly() {
        let session = win(QuotaWindowKind::Session, 10.0, NOW + 10_000, None);
        let model = win(QuotaWindowKind::WeeklyModel, 88.0, NOW + 10_000, Some("opus"));
        let q = quota(Some(session), None, vec![model.clone()]);
        assert_eq!(select_tightest_window(&q, NOW), Some(&model));
    }

    #[test]
    fn breaks_ties_by_keeping_earlier_window() {
        let session = win(QuotaWindowKind::Session, 50.0, NOW + 10_000, None);
        let weekly = win(QuotaWindowKind::Weekly, 50.0, NOW + 10_000, None);
        let q = quota(Some(session.clone()), Some(weekly), vec![]);
        assert_eq!(select_tightest_window(&q, NOW), Some(&session));
    }
}
