//! Normalizes a stream-json `rate_limit_event`'s `rate_limit_info` into a partial
//! `ProviderQuota` escalation. Returns `None` when it carries no usable percent —
//! `utilization` is only populated in warning/rejected states, so a healthy event
//! cannot drive an ambient gauge and is dropped. Unit trap: `utilization` is a
//! 0-1 fraction and `resetsAt` is epoch seconds; both normalize to percent 0-100
//! and epoch ms.

use serde_json::Value;

use mainframe_types::adapter::{ProviderQuota, ProviderQuotaStatus, QuotaWindow, QuotaWindowKind};

struct KindMapping {
    kind: QuotaWindowKind,
    label: Option<&'static str>,
}

/// Claude's `rateLimitType` wire values -> our normalized window kind + label.
/// `overage` is intentionally absent: it is a paid-credit bucket, not a plan window.
fn kind_by_type(rate_limit_type: &str) -> Option<KindMapping> {
    match rate_limit_type {
        "five_hour" => Some(KindMapping {
            kind: QuotaWindowKind::Session,
            label: None,
        }),
        "seven_day" => Some(KindMapping {
            kind: QuotaWindowKind::Weekly,
            label: None,
        }),
        "seven_day_opus" => Some(KindMapping {
            kind: QuotaWindowKind::WeeklyModel,
            label: Some("opus"),
        }),
        "seven_day_sonnet" => Some(KindMapping {
            kind: QuotaWindowKind::WeeklyModel,
            label: Some("sonnet"),
        }),
        _ => None,
    }
}

pub(crate) fn normalize_rate_limit_event(info: Option<&Value>, now: i64) -> Option<ProviderQuota> {
    let info = info?;
    let utilization = info.get("utilization")?.as_f64()?;
    let rate_limit_type = info.get("rateLimitType")?.as_str()?;
    let mapping = kind_by_type(rate_limit_type)?;

    let window = QuotaWindow {
        kind: mapping.kind,
        used_percent: (utilization * 100.0).round(),
        resets_at: info
            .get("resetsAt")
            .and_then(Value::as_i64)
            .map(|s| s * 1000),
        observed_at: Some(now),
        label: mapping.label.map(str::to_string),
    };

    let mut quota = ProviderQuota {
        status: ProviderQuotaStatus::Ok,
        observed_at: now,
        session: None,
        weekly: None,
        model_windows: Vec::new(),
        account_identity: None,
    };
    match mapping.kind {
        QuotaWindowKind::Session => quota.session = Some(window),
        QuotaWindowKind::Weekly => quota.weekly = Some(window),
        QuotaWindowKind::WeeklyModel => quota.model_windows = vec![window],
    }
    Some(quota)
}

#[cfg(test)]
#[path = "quota_rate_limit_tests.rs"]
mod tests;
