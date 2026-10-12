use super::*;

const FIXTURE: &str = include_str!("__fixtures__/claude-usage.txt");

// A fixed clock before both reset instants so the future-year inference picks 2026.
fn now() -> i64 {
    chrono::Utc
        .with_ymd_and_hms(2026, 7, 18, 6, 0, 0)
        .unwrap()
        .timestamp_millis()
}
fn session_reset() -> i64 {
    chrono::Utc
        .with_ymd_and_hms(2026, 7, 18, 7, 10, 0)
        .unwrap()
        .timestamp_millis()
}
fn weekly_reset() -> i64 {
    chrono::Utc
        .with_ymd_and_hms(2026, 7, 23, 13, 0, 0)
        .unwrap()
        .timestamp_millis()
}

#[test]
fn parses_all_three_windows_from_the_golden_fixture() {
    let quota = parse_claude_usage(FIXTURE, now());
    assert_eq!(quota.status, ProviderQuotaStatus::Ok);
    assert_eq!(quota.observed_at, now());
    assert_eq!(
        quota.session,
        Some(QuotaWindow {
            kind: QuotaWindowKind::Session,
            used_percent: 19.0,
            resets_at: Some(session_reset()),
            observed_at: Some(now()),
            label: None,
        })
    );
    assert_eq!(
        quota.weekly,
        Some(QuotaWindow {
            kind: QuotaWindowKind::Weekly,
            used_percent: 25.0,
            resets_at: Some(weekly_reset()),
            observed_at: Some(now()),
            label: None,
        })
    );
    assert_eq!(
        quota.model_windows,
        vec![QuotaWindow {
            kind: QuotaWindowKind::WeeklyModel,
            used_percent: 33.0,
            resets_at: Some(weekly_reset()),
            observed_at: Some(now()),
            label: Some("Fable".to_string()),
        }]
    );
}

#[test]
fn never_parses_the_whats_contributing_breakdown_into_windows() {
    let quota = parse_claude_usage(FIXTURE, now());
    assert_eq!(quota.model_windows.len(), 1);
}

#[test]
fn keeps_the_percent_but_nulls_resets_at_when_the_reset_is_unparseable() {
    let quota = parse_claude_usage("Current session: 42% used \u{b7} resets soon", now());
    assert_eq!(quota.status, ProviderQuotaStatus::Ok);
    assert_eq!(
        quota.session,
        Some(QuotaWindow {
            kind: QuotaWindowKind::Session,
            used_percent: 42.0,
            resets_at: None,
            observed_at: Some(now()),
            label: None,
        })
    );
}

#[test]
fn fails_the_whole_provider_to_unknown_on_an_unclassifiable_non_empty_line() {
    let text = "You are currently using your subscription to power your Claude Code usage\n\nTotally unexpected line";
    let quota = parse_claude_usage(text, now());
    assert_eq!(quota.status, ProviderQuotaStatus::Unknown);
    assert_eq!(quota.model_windows, Vec::<QuotaWindow>::new());
    assert_eq!(quota.observed_at, now());
}

#[test]
fn fails_the_whole_provider_to_unknown_when_a_recognized_window_line_has_no_percent() {
    let quota = parse_claude_usage(
        "Current session: resets Jul 18 at 10:10am (Europe/Bucharest)",
        now(),
    );
    assert_eq!(quota.status, ProviderQuotaStatus::Unknown);
    assert_eq!(quota.session, None);
}

#[test]
fn returns_unknown_for_the_recognized_non_subscriber_message() {
    let quota = parse_claude_usage("/usage is only available for subscription plans", now());
    assert_eq!(quota.status, ProviderQuotaStatus::Unknown);
    assert_eq!(quota.model_windows, Vec::<QuotaWindow>::new());
    assert_eq!(quota.observed_at, now());
}

#[test]
fn parses_the_reset_with_the_meridiem_glued_to_the_time() {
    let quota = parse_claude_usage(
        "Current session: 19% used \u{b7} resets Jul 18 at 10:10am (Europe/Bucharest)",
        now(),
    );
    assert_eq!(quota.session.unwrap().resets_at, Some(session_reset()));
}

#[test]
fn parses_the_reset_with_a_space_before_the_meridiem() {
    let quota = parse_claude_usage(
        "Current session: 19% used \u{b7} resets Jul 18 at 10:10 am (Europe/Bucharest)",
        now(),
    );
    assert_eq!(quota.session.unwrap().resets_at, Some(session_reset()));
}

#[test]
fn parses_the_percent_with_and_without_a_space_before_used() {
    let spaced = parse_claude_usage("Current session: 50% used", now());
    let glued = parse_claude_usage("Current session: 50%used", now());
    assert_eq!(spaced.session.unwrap().used_percent, 50.0);
    assert_eq!(glued.session.unwrap().used_percent, 50.0);
}

#[test]
fn returns_unknown_when_no_windows_are_present_at_all() {
    let quota = parse_claude_usage(
        "You are currently using your subscription to power your Claude Code usage",
        now(),
    );
    assert_eq!(quota.status, ProviderQuotaStatus::Unknown);
}
