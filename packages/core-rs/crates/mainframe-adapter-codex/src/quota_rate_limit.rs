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

pub(crate) fn normalize_rate_limit_snapshot(
    snapshot: &RateLimitSnapshot,
    now: i64,
) -> ProviderQuota {
    let mut quota = ProviderQuota {
        status: ProviderQuotaStatus::Ok,
        observed_at: now,
        session: None,
        weekly: None,
        model_windows: Vec::new(),
        account_identity: None,
    };

    for raw in [&snapshot.primary, &snapshot.secondary] {
        let Some((kind, window)) = map_window(raw.as_ref(), now) else {
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

fn map_window(
    window: Option<&RateLimitWindow>,
    now: i64,
) -> Option<(QuotaWindowKind, QuotaWindow)> {
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
            observed_at: Some(now),
            label: None,
        },
    ))
}

/// Whether a normalized snapshot recognized at least one window. Zero recognized
/// windows (an all-unrecognized or empty snapshot) must not ingest — it would bump
/// freshness without any data behind it (#268/C2).
#[must_use]
pub(crate) fn has_recognized_window(quota: &ProviderQuota) -> bool {
    quota.session.is_some() || quota.weekly.is_some() || !quota.model_windows.is_empty()
}

/// Whether the raw snapshot carried any window slot at all. Used to distinguish a
/// genuine format drift (windows present but none recognized -> warn) from a benign
/// empty snapshot.
#[must_use]
pub(crate) fn snapshot_has_window(snapshot: &RateLimitSnapshot) -> bool {
    snapshot.primary.is_some() || snapshot.secondary.is_some()
}

#[cfg(test)]
#[path = "quota_rate_limit_tests.rs"]
mod tests;
