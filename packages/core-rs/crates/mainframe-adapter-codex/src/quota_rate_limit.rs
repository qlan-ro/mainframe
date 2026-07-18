//! Ported from `packages/core/src/plugins/builtin/codex/quota-rate-limit.ts`.
//!
//! Normalizes an `account/rateLimits/updated` (or `.../read`) snapshot into a
//! `ProviderQuota`. Each window is keyed by `windowDurationMins` (300=session,
//! 10080=weekly), never by its `primary`/`secondary` slot; an absent or
//! unrecognized window is dropped, not zeroed, so a sparse snapshot only ever
//! sets the fields it actually has data for (callers merge onto last-known).

use mainframe_types::adapter::{ProviderQuota, ProviderQuotaStatus, QuotaWindow, QuotaWindowKind};

use crate::types::{RateLimitSnapshot, RateLimitWindow};

fn kind_by_duration_mins(mins: i64) -> Option<QuotaWindowKind> {
    match mins {
        300 => Some(QuotaWindowKind::Session),
        10080 => Some(QuotaWindowKind::Weekly),
        _ => None,
    }
}

pub fn normalize_rate_limit_snapshot(snapshot: &RateLimitSnapshot, now: i64) -> ProviderQuota {
    let mut quota = ProviderQuota {
        status: ProviderQuotaStatus::Ok,
        observed_at: now,
        session: None,
        weekly: None,
        model_windows: Vec::new(),
        account_identity: None,
    };

    for raw in [&snapshot.primary, &snapshot.secondary] {
        let Some((kind, window)) = map_window(raw.as_ref()) else {
            continue;
        };
        match kind {
            QuotaWindowKind::Session => quota.session = Some(window),
            QuotaWindowKind::Weekly => quota.weekly = Some(window),
            // Codex never maps to this Claude-only kind; kind_by_duration_mins never returns it.
            QuotaWindowKind::WeeklyModel => {
                unreachable!("codex windows only map to session/weekly")
            }
        }
    }

    quota
}

fn map_window(window: Option<&RateLimitWindow>) -> Option<(QuotaWindowKind, QuotaWindow)> {
    let window = window?;
    let kind = window.window_duration_mins.and_then(kind_by_duration_mins);
    let Some(kind) = kind else {
        tracing::warn!(
            window_duration_mins = ?window.window_duration_mins,
            "codex rate limit: unrecognized window duration, dropping window"
        );
        return None;
    };
    Some((
        kind,
        QuotaWindow {
            kind,
            used_percent: window.used_percent,
            resets_at: window.resets_at.map(|secs| secs * 1000),
            label: None,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_752_814_800_000;

    fn window(
        used_percent: f64,
        window_duration_mins: Option<i64>,
        resets_at: Option<i64>,
    ) -> RateLimitWindow {
        RateLimitWindow {
            used_percent,
            window_duration_mins,
            resets_at,
        }
    }

    fn snapshot(
        primary: Option<RateLimitWindow>,
        secondary: Option<RateLimitWindow>,
    ) -> RateLimitSnapshot {
        RateLimitSnapshot {
            limit_id: None,
            limit_name: None,
            primary,
            secondary,
        }
    }

    #[test]
    fn maps_a_300_minute_window_to_session() {
        let quota = normalize_rate_limit_snapshot(
            &snapshot(Some(window(19.0, Some(300), Some(1_752_828_600))), None),
            NOW,
        );
        assert_eq!(quota.status, ProviderQuotaStatus::Ok);
        assert_eq!(quota.observed_at, NOW);
        let session = quota.session.unwrap();
        assert_eq!(session.kind, QuotaWindowKind::Session);
        assert_eq!(session.used_percent, 19.0);
        assert_eq!(session.resets_at, Some(1_752_828_600_000));
        assert!(quota.weekly.is_none());
    }

    #[test]
    fn maps_a_10080_minute_window_to_weekly() {
        let quota = normalize_rate_limit_snapshot(
            &snapshot(None, Some(window(42.0, Some(10080), Some(1_753_419_600)))),
            NOW,
        );
        let weekly = quota.weekly.unwrap();
        assert_eq!(weekly.kind, QuotaWindowKind::Weekly);
        assert_eq!(weekly.used_percent, 42.0);
        assert_eq!(weekly.resets_at, Some(1_753_419_600_000));
        assert!(quota.session.is_none());
    }

    #[test]
    fn maps_both_windows_when_both_are_present() {
        let quota = normalize_rate_limit_snapshot(
            &snapshot(
                Some(window(19.0, Some(300), Some(1_752_828_600))),
                Some(window(42.0, Some(10080), Some(1_753_419_600))),
            ),
            NOW,
        );
        assert_eq!(quota.session.unwrap().used_percent, 19.0);
        assert_eq!(quota.weekly.unwrap().used_percent, 42.0);
    }

    #[test]
    fn drops_a_window_with_a_null_resets_at() {
        let quota = normalize_rate_limit_snapshot(
            &snapshot(Some(window(19.0, Some(300), None)), None),
            NOW,
        );
        assert_eq!(quota.session.unwrap().resets_at, None);
    }

    #[test]
    fn drops_a_window_with_an_unrecognized_duration() {
        let quota = normalize_rate_limit_snapshot(
            &snapshot(Some(window(19.0, Some(60), Some(1_752_828_600))), None),
            NOW,
        );
        assert!(quota.session.is_none());
        assert!(quota.weekly.is_none());
    }

    #[test]
    fn drops_a_window_with_a_null_duration() {
        let quota = normalize_rate_limit_snapshot(
            &snapshot(Some(window(19.0, None, Some(1_752_828_600))), None),
            NOW,
        );
        assert!(quota.session.is_none());
        assert!(quota.weekly.is_none());
    }

    #[test]
    fn returns_an_empty_quota_when_both_windows_are_absent() {
        let quota = normalize_rate_limit_snapshot(&snapshot(None, None), NOW);
        assert_eq!(quota.status, ProviderQuotaStatus::Ok);
        assert!(quota.session.is_none());
        assert!(quota.weekly.is_none());
    }
}

// PORT STATUS: src/plugins/builtin/codex/quota-rate-limit.ts (46 lines)
// confidence: high
// todos: 0
// notes: kind_by_duration_mins is a match (not the TS lookup object) but the
// notes: 300/10080 -> session/weekly mapping and the drop-on-unrecognized/null-
// notes: duration behavior are identical; resetsAt sec->ms conversion and the
// notes: sparse per-window Option semantics match normalizeRateLimitSnapshot exactly.
