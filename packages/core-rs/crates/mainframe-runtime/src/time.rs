//! ISO-8601 timestamp helpers — the single source of `Date.toISOString()` wire
//! parity. Every timestamp *string* field the daemon emits (events, chats,
//! `/health`, …) must go through here so the bytes match the Node daemon.
//!
//! `chrono::DateTime::to_rfc3339()` alone is NOT a valid substitute: it emits
//! microsecond precision and a `+00:00` offset (`...30.123456+00:00`), whereas
//! Node's `Date.toISOString()` emits millisecond precision and a literal `Z`
//! (`...30.123Z`). Use these helpers, never `to_rfc3339()`, for wire output.

use chrono::{DateTime, SecondsFormat, Utc};

/// Formats `dt` exactly as JS `Date.prototype.toISOString()` does: millisecond
/// precision, `Z` suffix (e.g. `2026-07-08T10:15:30.000Z`).
pub fn to_iso8601(dt: DateTime<Utc>) -> String {
    dt.to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// The current UTC instant as an ISO-8601 millis/`Z` string, matching
/// `new Date().toISOString()`.
pub fn now_iso8601() -> String {
    to_iso8601(Utc::now())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Timelike};

    #[test]
    fn to_iso8601_matches_node_to_iso_string() {
        // 2026-07-08T10:15:30.000Z — the shape Node's toISOString() produces.
        let dt = Utc.with_ymd_and_hms(2026, 7, 8, 10, 15, 30).unwrap();
        assert_eq!(to_iso8601(dt), "2026-07-08T10:15:30.000Z");
    }

    #[test]
    fn to_iso8601_truncates_to_millis_and_uses_z() {
        // 123_456 micros -> 123 millis; no `+00:00` offset.
        let dt = Utc
            .with_ymd_and_hms(2026, 7, 8, 10, 15, 30)
            .unwrap()
            .with_nanosecond(123_456_000)
            .unwrap();
        assert_eq!(to_iso8601(dt), "2026-07-08T10:15:30.123Z");
    }

    #[test]
    fn now_iso8601_is_millis_precision_z_suffixed() {
        let ts = now_iso8601();
        assert!(ts.ends_with('Z'), "must be Z-suffixed UTC: {ts}");
        assert_eq!(ts.len(), 24, "must be millis-precision ISO-8601: {ts}");
        assert_eq!(
            &ts[19..20],
            ".",
            "must have a fractional-second separator: {ts}"
        );
    }
}

// PORT STATUS: (new helper — no direct TS source file)
// confidence: high
// todos: 0
// notes: shared iso8601 helper backing PORTING.md §4's toISOString() wire-parity
// rule; `use chrono::Utc; chrono::Timelike::with_nanosecond` is pulled in the test
// module only. Consumers: mainframe-server::routes::health (and future timestamp
// string fields). Never emit `to_rfc3339()` for wire output — it drifts (micros/+00:00).
