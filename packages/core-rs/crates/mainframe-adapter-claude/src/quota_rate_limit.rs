//! Ported from `packages/core/src/plugins/builtin/claude/quota-rate-limit.ts`.
//!
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
        "five_hour" => Some(KindMapping { kind: QuotaWindowKind::Session, label: None }),
        "seven_day" => Some(KindMapping { kind: QuotaWindowKind::Weekly, label: None }),
        "seven_day_opus" => Some(KindMapping { kind: QuotaWindowKind::WeeklyModel, label: Some("opus") }),
        "seven_day_sonnet" => Some(KindMapping { kind: QuotaWindowKind::WeeklyModel, label: Some("sonnet") }),
        _ => None,
    }
}

pub fn normalize_rate_limit_event(info: Option<&Value>, now: i64) -> Option<ProviderQuota> {
    let info = info?;
    let utilization = info.get("utilization")?.as_f64()?;
    let rate_limit_type = info.get("rateLimitType")?.as_str()?;
    let mapping = kind_by_type(rate_limit_type)?;

    let window = QuotaWindow {
        kind: mapping.kind,
        used_percent: (utilization * 100.0).round(),
        resets_at: info.get("resetsAt").and_then(Value::as_i64).map(|s| s * 1000),
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
mod tests {
    use super::*;
    use serde_json::json;

    const NOW: i64 = 1_700_000_000_000;

    #[test]
    fn maps_a_five_hour_warning_to_a_session_window() {
        let info = json!({ "status": "allowed_warning", "rateLimitType": "five_hour", "utilization": 0.93, "resetsAt": 1_789_999_999i64 });
        let quota = normalize_rate_limit_event(Some(&info), NOW).unwrap();
        assert_eq!(quota.status, ProviderQuotaStatus::Ok);
        assert_eq!(quota.observed_at, NOW);
        assert_eq!(quota.model_windows, Vec::<QuotaWindow>::new());
        assert_eq!(
            quota.session,
            Some(QuotaWindow {
                kind: QuotaWindowKind::Session,
                used_percent: 93.0,
                resets_at: Some(1_789_999_999_000),
                label: None,
            })
        );
    }

    #[test]
    fn maps_seven_day_to_a_weekly_window() {
        let info = json!({ "rateLimitType": "seven_day", "utilization": 0.5, "resetsAt": 1_789_999_999i64 });
        let quota = normalize_rate_limit_event(Some(&info), NOW).unwrap();
        assert_eq!(
            quota.weekly,
            Some(QuotaWindow { kind: QuotaWindowKind::Weekly, used_percent: 50.0, resets_at: Some(1_789_999_999_000), label: None })
        );
        assert_eq!(quota.session, None);
    }

    #[test]
    fn maps_seven_day_opus_to_a_labeled_weekly_model_window() {
        let info = json!({ "rateLimitType": "seven_day_opus", "utilization": 0.8 });
        let quota = normalize_rate_limit_event(Some(&info), NOW).unwrap();
        assert_eq!(
            quota.model_windows,
            vec![QuotaWindow { kind: QuotaWindowKind::WeeklyModel, used_percent: 80.0, resets_at: None, label: Some("opus".to_string()) }]
        );
    }

    #[test]
    fn returns_none_for_a_healthy_event_carrying_no_utilization() {
        let info = json!({ "status": "allowed", "rateLimitType": "five_hour" });
        assert!(normalize_rate_limit_event(Some(&info), NOW).is_none());
    }

    #[test]
    fn returns_none_for_the_overage_window() {
        let info = json!({ "rateLimitType": "overage", "utilization": 0.9 });
        assert!(normalize_rate_limit_event(Some(&info), NOW).is_none());
    }

    #[test]
    fn returns_none_when_rate_limit_info_is_missing() {
        assert!(normalize_rate_limit_event(None, NOW).is_none());
    }
}

// PORT STATUS: src/plugins/builtin/claude/quota-rate-limit.ts (43 lines)
// confidence: high
// todos: 0
// notes: table cases ported verbatim with hardcoded expected values; wired at the
// notes: `rate_limit_event` arm in events.rs (previously unhandled — no match arm
// notes: existed for this event type before this port).
