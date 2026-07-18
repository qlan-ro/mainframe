//! Ported from `packages/core/src/plugins/builtin/claude/quota-parse.ts`.
//!
//! Anchor-based parser for the human-prose output of `claude -p "/usage"`. Percent
//! is load-bearing (a parse failure fails the whole provider to `unknown`, #251);
//! reset is best-effort (an unparseable reset nulls that window's `resetsAt` and
//! logs loudly, keeping the trustworthy percent). Never parses the local "What's
//! contributing" breakdown — that region ends the scan entirely.

use chrono::{Datelike, NaiveDate, TimeZone};
use chrono_tz::Tz;

use mainframe_types::adapter::{ProviderQuota, ProviderQuotaStatus, QuotaWindow, QuotaWindowKind};

const MONTHS: [&str; 12] = [
    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

fn unknown(observed_at: i64) -> ProviderQuota {
    ProviderQuota {
        status: ProviderQuotaStatus::Unknown,
        session: None,
        weekly: None,
        model_windows: Vec::new(),
        observed_at,
        account_identity: None,
    }
}

/// Parse `claude -p "/usage"` prose into a `ProviderQuota`. Mirrors `parseClaudeUsage`.
pub fn parse_claude_usage(text: &str, now: i64) -> ProviderQuota {
    let mut session: Option<QuotaWindow> = None;
    let mut weekly: Option<QuotaWindow> = None;
    let mut model_windows: Vec<QuotaWindow> = Vec::new();
    let mut saw_window = false;

    for raw in text.split('\n') {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if is_contributing_anchor(line) {
            break;
        }
        if is_subscription_preamble(line) {
            continue;
        }
        if is_no_data(line) {
            tracing::info!(line, "claude /usage: recognized no-data (non-subscriber)");
            return unknown(now);
        }

        if is_session_line(line) {
            let Some(w) = parse_window(QuotaWindowKind::Session, line, now, None) else {
                return fail_closed(line, now);
            };
            session = Some(w);
        } else if is_weekly_all_line(line) {
            let Some(w) = parse_window(QuotaWindowKind::Weekly, line, now, None) else {
                return fail_closed(line, now);
            };
            weekly = Some(w);
        } else if let Some(label) = weekly_model_label(line) {
            let Some(w) = parse_window(QuotaWindowKind::WeeklyModel, line, now, Some(label)) else {
                return fail_closed(line, now);
            };
            model_windows.push(w);
        } else {
            tracing::warn!(line, "claude /usage: unclassifiable line, failing provider to unknown");
            return unknown(now);
        }
        saw_window = true;
    }

    if !saw_window {
        tracing::info!("claude /usage: no windows recognized, provider unknown");
        return unknown(now);
    }
    ProviderQuota {
        status: ProviderQuotaStatus::Ok,
        observed_at: now,
        session,
        weekly,
        model_windows,
        account_identity: None,
    }
}

fn fail_closed(line: &str, now: i64) -> ProviderQuota {
    tracing::warn!(line, "claude /usage: percent parse failed, failing provider to unknown");
    unknown(now)
}

fn is_contributing_anchor(line: &str) -> bool {
    line.to_lowercase().starts_with("what's contributing")
}

fn is_subscription_preamble(line: &str) -> bool {
    line.to_lowercase().contains("using your subscription")
}

fn is_no_data(line: &str) -> bool {
    let lower = line.to_lowercase();
    lower.contains("only available for")
        || lower.contains("only available on")
        || lower.contains("subscription plan")
        || lower.contains("api key")
        || lower.contains("api-key")
        || lower.contains("apikey")
}

fn is_session_line(line: &str) -> bool {
    line.to_lowercase().starts_with("current session:")
}

fn is_weekly_all_line(line: &str) -> bool {
    line.to_lowercase().starts_with("current week (all models):")
}

/// `^Current week \(([^)]+)\):` — returns the parenthetical label when the line
/// matches and isn't the "(all models)" line (checked by the caller beforehand).
fn weekly_model_label(line: &str) -> Option<&str> {
    let rest = strip_prefix_ci(line, "current week (")?;
    let close = rest.find(')')?;
    let label = &rest[..close];
    if rest[close..].starts_with("):") {
        Some(label)
    } else {
        None
    }
}

fn strip_prefix_ci<'a>(line: &'a str, prefix: &str) -> Option<&'a str> {
    if line.len() < prefix.len() {
        return None;
    }
    let (head, tail) = line.split_at(prefix.len());
    if head.eq_ignore_ascii_case(prefix) {
        Some(tail)
    } else {
        None
    }
}

fn parse_window(kind: QuotaWindowKind, line: &str, now: i64, label: Option<&str>) -> Option<QuotaWindow> {
    let percent = parse_percent(line)?;
    Some(QuotaWindow {
        kind,
        used_percent: percent,
        resets_at: parse_reset_to_epoch_ms(line, now),
        observed_at: Some(now),
        label: label.map(str::to_string),
    })
}

/// `(\d+)%\s+used` — case-insensitive digits-before-percent-before-"used".
fn parse_percent(line: &str) -> Option<f64> {
    let percent_idx = line.find('%')?;
    let digits_start = line[..percent_idx]
        .rfind(|c: char| !c.is_ascii_digit())
        .map(|i| i + 1)
        .unwrap_or(0);
    let digits = &line[digits_start..percent_idx];
    if digits.is_empty() {
        return None;
    }
    let after = line[percent_idx + 1..].trim_start();
    if !after.to_lowercase().starts_with("used") {
        return None;
    }
    digits.parse::<f64>().ok()
}

/// `resets\s+([A-Za-z]{3,})\s+(\d{1,2})\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^)]+)\)`
fn parse_reset_to_epoch_ms(line: &str, now: i64) -> Option<i64> {
    let lower = line.to_lowercase();
    let resets_idx = lower.find("resets")?;
    let rest = line[resets_idx + "resets".len()..].trim_start();

    let (month_tok, rest) = take_token(rest)?;
    if month_tok.chars().count() < 3 || !month_tok.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    let month = MONTHS
        .iter()
        .position(|m| month_tok.to_lowercase().starts_with(m))?;

    let (day_tok, rest) = take_token(rest)?;
    let day: u32 = day_tok.parse().ok()?;

    let rest = strip_prefix_ci(rest.trim_start(), "at ").or_else(|| strip_prefix_ci(rest.trim_start(), "at"))?;
    let rest = rest.trim_start();

    let (time_tok, after_time) = take_token(rest)?;
    let (hour12, minute, is_pm, rest) = parse_time_and_meridiem(time_tok, after_time)?;

    let rest = rest.trim_start();
    let paren_start = rest.find('(')?;
    let paren_end = rest[paren_start..].find(')')? + paren_start;
    let zone = rest[paren_start + 1..paren_end].trim();

    let hour = (hour12 % 12) + if is_pm { 12 } else { 0 };
    let year = chrono::DateTime::from_timestamp_millis(now)?.naive_utc().date().year();

    future_wall_clock_to_epoch_ms(year, month, day, hour, minute, zone, now)
}

/// Splits leading whitespace-delimited token; if the time is glued to am/pm
/// (`10:10am`), the whole glued chunk is returned as one token.
fn take_token(s: &str) -> Option<(&str, &str)> {
    let s = s.trim_start();
    if s.is_empty() {
        return None;
    }
    let end = s.find(char::is_whitespace).unwrap_or(s.len());
    Some((&s[..end], &s[end..]))
}

/// Resolves the clock + meridiem, accepting the meridiem glued to the time
/// (`10:10am`) or separated by whitespace (`10:10 am`, already split into a
/// following token). Returns `(hour12, minute, is_pm, remaining)`; the meridiem is
/// required — a bare `10:10` yields `None`, mirroring the TS `(am|pm)` group.
fn parse_time_and_meridiem<'a>(
    time_tok: &str,
    after_time: &'a str,
) -> Option<(u32, u32, bool, &'a str)> {
    let lower = time_tok.to_lowercase();
    if let Some(digits) = lower.strip_suffix("am") {
        let (hour, minute) = parse_hour_minute(digits)?;
        return Some((hour, minute, false, after_time));
    }
    if let Some(digits) = lower.strip_suffix("pm") {
        let (hour, minute) = parse_hour_minute(digits)?;
        return Some((hour, minute, true, after_time));
    }
    let (hour, minute) = parse_hour_minute(&lower)?;
    let (meridiem_tok, rest) = take_token(after_time)?;
    match meridiem_tok.to_lowercase().as_str() {
        "am" => Some((hour, minute, false, rest)),
        "pm" => Some((hour, minute, true, rest)),
        _ => None,
    }
}

/// Parses `10` or `10:10` into `(hour, minute)`; a missing minute defaults to 0.
fn parse_hour_minute(digits: &str) -> Option<(u32, u32)> {
    let mut parts = digits.splitn(2, ':');
    let hour: u32 = parts.next()?.parse().ok()?;
    let minute: u32 = match parts.next() {
        Some(m) => m.parse().ok()?,
        None => 0,
    };
    Some((hour, minute))
}

/// A reset is always in the future; if this year's instant already passed, roll to next year.
fn future_wall_clock_to_epoch_ms(
    year: i32,
    month: usize,
    day: u32,
    hour: u32,
    minute: u32,
    zone: &str,
    now: i64,
) -> Option<i64> {
    let epoch = wall_clock_in_zone_to_epoch_ms(year, month, day, hour, minute, zone)?;
    if epoch < now {
        wall_clock_in_zone_to_epoch_ms(year + 1, month, day, hour, minute, zone)
    } else {
        Some(epoch)
    }
}

fn wall_clock_in_zone_to_epoch_ms(
    year: i32,
    month: usize,
    day: u32,
    hour: u32,
    minute: u32,
    zone: &str,
) -> Option<i64> {
    let tz: Tz = zone.parse().ok()?;
    let naive = NaiveDate::from_ymd_opt(year, (month as u32) + 1, day)?.and_hms_opt(hour, minute, 0)?;
    let local = tz.from_local_datetime(&naive).single()?;
    Some(local.timestamp_millis())
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!("__fixtures__/claude-usage.txt");

    // A fixed clock before both reset instants so the future-year inference picks 2026.
    fn now() -> i64 {
        chrono::Utc.with_ymd_and_hms(2026, 7, 18, 6, 0, 0).unwrap().timestamp_millis()
    }
    fn session_reset() -> i64 {
        chrono::Utc.with_ymd_and_hms(2026, 7, 18, 7, 10, 0).unwrap().timestamp_millis()
    }
    fn weekly_reset() -> i64 {
        chrono::Utc.with_ymd_and_hms(2026, 7, 23, 13, 0, 0).unwrap().timestamp_millis()
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
        let quota = parse_claude_usage("Current session: resets Jul 18 at 10:10am (Europe/Bucharest)", now());
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
        let quota = parse_claude_usage("You are currently using your subscription to power your Claude Code usage", now());
        assert_eq!(quota.status, ProviderQuotaStatus::Unknown);
    }
}

// PORT STATUS: src/plugins/builtin/claude/quota-parse.ts (158 lines)
// confidence: high
// todos: 0
// notes: hand-rolled anchor matching (no regex crate in this workspace, matching
// notes: events.rs precedent) instead of the TS RegExp literals; same anchors,
// notes: same fail-closed/best-effort split. Reset zone math uses chrono-tz's
// notes: `TimeZone::from_local_datetime` directly instead of the TS Intl-based
// notes: offset derivation — same result, no hand-rolled UTC-offset arithmetic
// notes: needed on this side. Golden fixture copied verbatim into
// notes: src/__fixtures__/claude-usage.txt from the TS test fixture.
