//! The idle history release setting: how long a chat nobody views or uses
//! keeps its history in the daemon's memory. Stored as the `general` key
//! `historyRelease.idleMinutes` (a whole number of minutes, or `never`); a
//! missing or unreadable row means the default.

use serde::{Deserialize, Serialize};

pub const HISTORY_RELEASE_DEFAULT_MINUTES: u32 = 10;
/// One day: a longer wait is no different from never in practice.
pub const HISTORY_RELEASE_MAX_MINUTES: u32 = 24 * 60;
/// The stored value for "never release".
pub const HISTORY_RELEASE_NEVER: &str = "never";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryReleaseConfig {
    /// Minutes of idle time before a chat's history is released; `None`
    /// (`null` on the wire) keeps it until the two-hour idle offload.
    pub idle_minutes: Option<u32>,
}

impl Default for HistoryReleaseConfig {
    fn default() -> Self {
        Self {
            idle_minutes: Some(HISTORY_RELEASE_DEFAULT_MINUTES),
        }
    }
}

impl HistoryReleaseConfig {
    /// Accepts `None` and whole minutes from 1 to [`HISTORY_RELEASE_MAX_MINUTES`].
    pub fn is_valid(&self) -> bool {
        self.idle_minutes
            .is_none_or(|m| (1..=HISTORY_RELEASE_MAX_MINUTES).contains(&m))
    }

    /// The config a stored row holds; the default for a missing or invalid one.
    pub fn from_stored(raw: Option<&str>) -> Self {
        let Some(raw) = raw else {
            return Self::default();
        };
        if raw == HISTORY_RELEASE_NEVER {
            return Self { idle_minutes: None };
        }
        let parsed = Self {
            idle_minutes: raw.parse().ok(),
        };
        if parsed.idle_minutes.is_some() && parsed.is_valid() {
            parsed
        } else {
            Self::default()
        }
    }

    /// The row to store.
    pub fn stored_value(&self) -> String {
        match self.idle_minutes {
            Some(minutes) => minutes.to_string(),
            None => HISTORY_RELEASE_NEVER.to_string(),
        }
    }

    /// The idle time in milliseconds, or `None` for never.
    pub fn idle_ms(&self) -> Option<i64> {
        self.idle_minutes.map(|m| i64::from(m) * 60_000)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stored_rows_round_trip_and_bad_rows_fall_back_to_the_default() {
        for config in [
            HistoryReleaseConfig {
                idle_minutes: Some(5),
            },
            HistoryReleaseConfig {
                idle_minutes: Some(60),
            },
            HistoryReleaseConfig { idle_minutes: None },
        ] {
            assert_eq!(
                HistoryReleaseConfig::from_stored(Some(&config.stored_value())),
                config
            );
        }
        for raw in [
            None,
            Some("0"),
            Some("-5"),
            Some("1441"),
            Some("ten"),
            Some(""),
        ] {
            assert_eq!(
                HistoryReleaseConfig::from_stored(raw),
                HistoryReleaseConfig::default()
            );
        }
        assert_eq!(HistoryReleaseConfig::default().idle_ms(), Some(600_000));
        assert_eq!(HistoryReleaseConfig { idle_minutes: None }.idle_ms(), None);
    }

    #[test]
    fn wire_shape_uses_null_for_never() {
        let never = HistoryReleaseConfig { idle_minutes: None };
        assert_eq!(
            serde_json::to_value(never).unwrap(),
            serde_json::json!({ "idleMinutes": null })
        );
        assert_eq!(
            serde_json::to_value(HistoryReleaseConfig::default()).unwrap(),
            serde_json::json!({ "idleMinutes": 10 })
        );
    }
}
