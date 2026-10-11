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
            observed_at: Some(NOW),
            label: None,
        })
    );
}

#[test]
fn maps_seven_day_to_a_weekly_window() {
    let info =
        json!({ "rateLimitType": "seven_day", "utilization": 0.5, "resetsAt": 1_789_999_999i64 });
    let quota = normalize_rate_limit_event(Some(&info), NOW).unwrap();
    assert_eq!(
        quota.weekly,
        Some(QuotaWindow {
            kind: QuotaWindowKind::Weekly,
            used_percent: 50.0,
            resets_at: Some(1_789_999_999_000),
            observed_at: Some(NOW),
            label: None
        })
    );
    assert_eq!(quota.session, None);
}

#[test]
fn maps_seven_day_opus_to_a_labeled_weekly_model_window() {
    let info = json!({ "rateLimitType": "seven_day_opus", "utilization": 0.8 });
    let quota = normalize_rate_limit_event(Some(&info), NOW).unwrap();
    assert_eq!(
        quota.model_windows,
        vec![QuotaWindow {
            kind: QuotaWindowKind::WeeklyModel,
            used_percent: 80.0,
            resets_at: None,
            observed_at: Some(NOW),
            label: Some("opus".to_string())
        }]
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
