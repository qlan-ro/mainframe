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
    let quota =
        normalize_rate_limit_snapshot(&snapshot(Some(window(19.0, Some(300), None)), None), NOW);
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

#[test]
fn stamps_each_window_with_the_observed_at_clock() {
    let quota = normalize_rate_limit_snapshot(
        &snapshot(Some(window(19.0, Some(300), Some(1_752_828_600))), None),
        NOW,
    );
    assert_eq!(quota.session.unwrap().observed_at, Some(NOW));
}

#[test]
fn has_recognized_window_is_false_for_an_all_unrecognized_snapshot() {
    let quota = normalize_rate_limit_snapshot(
        &snapshot(Some(window(19.0, Some(60), Some(1_752_828_600))), None),
        NOW,
    );
    assert!(!has_recognized_window(&quota));
}

#[test]
fn has_recognized_window_is_true_when_at_least_one_window_maps() {
    let quota = normalize_rate_limit_snapshot(
        &snapshot(Some(window(19.0, Some(300), Some(1_752_828_600))), None),
        NOW,
    );
    assert!(has_recognized_window(&quota));
}

#[test]
fn snapshot_has_window_distinguishes_present_slots_from_an_empty_snapshot() {
    assert!(snapshot_has_window(&snapshot(
        Some(window(19.0, Some(60), Some(1_752_828_600))),
        None
    )));
    assert!(!snapshot_has_window(&snapshot(None, None)));
}
