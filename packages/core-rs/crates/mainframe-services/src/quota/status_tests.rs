use super::*;
use mainframe_types::adapter::{QuotaWindow, QuotaWindowKind};

const NOW: i64 = 1_720_000_000_000;

fn win(
    kind: QuotaWindowKind,
    used_percent: f64,
    resets_at: i64,
    label: Option<&str>,
) -> QuotaWindow {
    QuotaWindow {
        kind,
        used_percent,
        resets_at: Some(resets_at),
        observed_at: None,
        label: label.map(str::to_string),
    }
}

fn quota(
    session: Option<QuotaWindow>,
    weekly: Option<QuotaWindow>,
    model: Vec<QuotaWindow>,
) -> ProviderQuota {
    ProviderQuota {
        status: ProviderQuotaStatus::Unknown,
        session,
        weekly,
        model_windows: model,
        observed_at: NOW,
        account_identity: None,
    }
}

#[test]
fn ok_when_every_window_is_trusted() {
    let q = quota(
        Some(win(QuotaWindowKind::Session, 10.0, NOW + 1_000, None)),
        Some(win(QuotaWindowKind::Weekly, 20.0, NOW + 2_000, None)),
        vec![],
    );
    assert_eq!(derive_provider_status(&q, NOW), ProviderQuotaStatus::Ok);
}

#[test]
fn unknown_when_every_window_expired() {
    let q = quota(
        Some(win(QuotaWindowKind::Session, 10.0, NOW - 1, None)),
        Some(win(QuotaWindowKind::Weekly, 20.0, NOW - 1, None)),
        vec![],
    );
    assert_eq!(
        derive_provider_status(&q, NOW),
        ProviderQuotaStatus::Unknown
    );
}

#[test]
fn ok_when_at_least_one_window_still_trusted() {
    let q = quota(
        Some(win(QuotaWindowKind::Session, 10.0, NOW - 1, None)),
        Some(win(QuotaWindowKind::Weekly, 20.0, NOW + 1_000, None)),
        vec![],
    );
    assert_eq!(derive_provider_status(&q, NOW), ProviderQuotaStatus::Ok);
}

#[test]
fn unknown_when_no_windows_at_all() {
    let q = quota(None, None, vec![]);
    assert_eq!(
        derive_provider_status(&q, NOW),
        ProviderQuotaStatus::Unknown
    );
}

#[test]
fn fails_whole_provider_closed_when_only_model_window_expired() {
    let q = quota(
        None,
        None,
        vec![win(
            QuotaWindowKind::WeeklyModel,
            50.0,
            NOW - 1,
            Some("opus"),
        )],
    );
    assert_eq!(
        derive_provider_status(&q, NOW),
        ProviderQuotaStatus::Unknown
    );
}
