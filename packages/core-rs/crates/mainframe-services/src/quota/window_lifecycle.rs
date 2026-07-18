//! Ported from `src/quota/window-lifecycle.ts` — window trust/expiry + staleness.
//!
//! A window is trusted until its own `resetsAt` passes; a null `resetsAt` is
//! synthesized into a per-kind ceiling so a window can't display forever.

use mainframe_types::adapter::{ProviderQuota, QuotaWindow, QuotaWindowKind};

use super::constants::{
    SESSION_WINDOW_DURATION_MS, STALE_THRESHOLD_MS, WEEKLY_WINDOW_DURATION_MS,
};

fn window_duration_ms(kind: QuotaWindowKind) -> i64 {
    match kind {
        QuotaWindowKind::Session => SESSION_WINDOW_DURATION_MS,
        QuotaWindowKind::Weekly | QuotaWindowKind::WeeklyModel => WEEKLY_WINDOW_DURATION_MS,
    }
}

/// A null `resetsAt` is synthesized into a ceiling so a window can't display
/// forever. The ceiling anchors on the window's own `observedAt` when present
/// (#268) — falling back to the blob's `observed_at` — so a kept window's ceiling
/// doesn't float forward as the blob is re-observed on data-free pushes.
#[must_use]
pub fn effective_reset_at(window: &QuotaWindow, observed_at: i64) -> i64 {
    window.resets_at.unwrap_or_else(|| {
        window.observed_at.unwrap_or(observed_at) + window_duration_ms(window.kind)
    })
}

#[must_use]
pub fn is_window_trusted(window: &QuotaWindow, observed_at: i64, now: i64) -> bool {
    now < effective_reset_at(window, observed_at)
}

/// Staleness is a separate signal from expiry: it can fire well before a window's ceiling.
#[must_use]
pub fn is_provider_stale(quota: &ProviderQuota, now: i64) -> bool {
    now - quota.observed_at >= STALE_THRESHOLD_MS
}

/// Session, weekly, then the model windows in order — omitting absent universal windows.
#[must_use]
pub fn collect_quota_windows(quota: &ProviderQuota) -> Vec<&QuotaWindow> {
    let mut out = Vec::new();
    if let Some(session) = &quota.session {
        out.push(session);
    }
    if let Some(weekly) = &quota.weekly {
        out.push(weekly);
    }
    out.extend(quota.model_windows.iter());
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use mainframe_types::adapter::ProviderQuotaStatus;

    const NOW: i64 = 1_720_000_000_000;

    fn win(kind: QuotaWindowKind, used_percent: f64, resets_at: Option<i64>) -> QuotaWindow {
        QuotaWindow {
            kind,
            used_percent,
            resets_at,
            observed_at: None,
            label: None,
        }
    }

    fn quota(observed_at: i64) -> ProviderQuota {
        ProviderQuota {
            status: ProviderQuotaStatus::Ok,
            session: None,
            weekly: None,
            model_windows: vec![],
            observed_at,
            account_identity: None,
        }
    }

    #[test]
    fn effective_reset_uses_resets_at_when_present() {
        let window = win(QuotaWindowKind::Session, 10.0, Some(5_000));
        assert_eq!(effective_reset_at(&window, 1_000), 5_000);
    }

    #[test]
    fn effective_reset_synthesizes_session_ceiling_when_null() {
        let window = win(QuotaWindowKind::Session, 10.0, None);
        assert_eq!(
            effective_reset_at(&window, 1_000),
            1_000 + SESSION_WINDOW_DURATION_MS
        );
    }

    #[test]
    fn effective_reset_anchors_the_ceiling_on_the_windows_own_observed_at() {
        let window = QuotaWindow {
            kind: QuotaWindowKind::Session,
            used_percent: 10.0,
            resets_at: None,
            observed_at: Some(2_000),
            label: None,
        };
        // Blob observed_at (9_000) is ignored in favour of the window's own 2_000.
        assert_eq!(
            effective_reset_at(&window, 9_000),
            2_000 + SESSION_WINDOW_DURATION_MS
        );
    }

    #[test]
    fn effective_reset_synthesizes_weekly_ceiling_when_null() {
        let window = win(QuotaWindowKind::Weekly, 10.0, None);
        assert_eq!(
            effective_reset_at(&window, 1_000),
            1_000 + WEEKLY_WINDOW_DURATION_MS
        );
    }

    #[test]
    fn effective_reset_synthesizes_weekly_model_ceiling_when_null() {
        let window = win(QuotaWindowKind::WeeklyModel, 10.0, None);
        assert_eq!(
            effective_reset_at(&window, 1_000),
            1_000 + WEEKLY_WINDOW_DURATION_MS
        );
    }

    #[test]
    fn window_is_trusted_before_effective_reset() {
        let window = win(QuotaWindowKind::Session, 10.0, Some(NOW + 1));
        assert!(is_window_trusted(&window, NOW, NOW));
    }

    #[test]
    fn window_is_untrusted_at_effective_reset() {
        let window = win(QuotaWindowKind::Session, 10.0, Some(NOW));
        assert!(!is_window_trusted(&window, NOW, NOW));
    }

    #[test]
    fn window_is_untrusted_past_effective_reset() {
        let window = win(QuotaWindowKind::Session, 10.0, Some(NOW - 1));
        assert!(!is_window_trusted(&window, NOW, NOW));
    }

    #[test]
    fn provider_not_stale_before_threshold() {
        let q = quota(NOW - (STALE_THRESHOLD_MS - 1));
        assert!(!is_provider_stale(&q, NOW));
    }

    #[test]
    fn provider_stale_at_threshold() {
        let q = quota(NOW - STALE_THRESHOLD_MS);
        assert!(is_provider_stale(&q, NOW));
    }

    #[test]
    fn provider_stale_past_threshold() {
        let q = quota(NOW - STALE_THRESHOLD_MS - 1);
        assert!(is_provider_stale(&q, NOW));
    }

    #[test]
    fn collect_returns_session_weekly_model_in_order() {
        let session = win(QuotaWindowKind::Session, 1.0, None);
        let weekly = win(QuotaWindowKind::Weekly, 2.0, None);
        let model = QuotaWindow {
            kind: QuotaWindowKind::WeeklyModel,
            used_percent: 3.0,
            resets_at: None,
            observed_at: None,
            label: Some("opus".into()),
        };
        let q = ProviderQuota {
            status: ProviderQuotaStatus::Ok,
            session: Some(session.clone()),
            weekly: Some(weekly.clone()),
            model_windows: vec![model.clone()],
            observed_at: NOW,
            account_identity: None,
        };
        assert_eq!(collect_quota_windows(&q), vec![&session, &weekly, &model]);
    }

    #[test]
    fn collect_omits_absent_session_and_weekly() {
        let q = quota(NOW);
        assert!(collect_quota_windows(&q).is_empty());
    }
}
