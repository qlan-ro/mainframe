//! Quota window trust, expiry, and staleness.
//!
//! A window is trusted until its own `resetsAt` passes; a null `resetsAt` is
//! synthesized into a per-kind ceiling so a window can't display forever.

use mainframe_types::adapter::{ProviderQuota, QuotaWindow, QuotaWindowKind};

#[cfg(test)]
use super::constants::STALE_THRESHOLD_MS;
use super::constants::{SESSION_WINDOW_DURATION_MS, WEEKLY_WINDOW_DURATION_MS};

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
pub(crate) fn effective_reset_at(window: &QuotaWindow, observed_at: i64) -> i64 {
    window.resets_at.unwrap_or_else(|| {
        window.observed_at.unwrap_or(observed_at) + window_duration_ms(window.kind)
    })
}

#[must_use]
pub(crate) fn is_window_trusted(window: &QuotaWindow, observed_at: i64, now: i64) -> bool {
    now < effective_reset_at(window, observed_at)
}

/// Staleness is a separate signal from expiry: it can fire well before a window's ceiling.
#[must_use]
#[cfg(test)]
pub(crate) fn is_provider_stale(quota: &ProviderQuota, now: i64) -> bool {
    now - quota.observed_at >= STALE_THRESHOLD_MS
}

/// Session, weekly, then the model windows in order — omitting absent universal windows.
#[must_use]
pub(crate) fn collect_quota_windows(quota: &ProviderQuota) -> Vec<&QuotaWindow> {
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
#[path = "window_lifecycle_tests.rs"]
mod tests;
