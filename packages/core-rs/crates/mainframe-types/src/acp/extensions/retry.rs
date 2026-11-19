//! `_mainframe.dev/retry_status`: the transient "provider call is being
//! retried" signal, and the one parser that reads a retry count out of
//! provider text.
use serde::{Deserialize, Serialize};

/// `_mainframe.dev/retry_status`'s params. Transient: pushed live on the
/// session's FIFO, never persisted or replayed. `max_attempts` is present only
/// when the provider's own text carried the maximum for this attempt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryStatusParams {
    pub session_id: String,
    pub attempt: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_attempts: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// The first `N/M` token in `text` (`Reconnecting... 2/5` → `(2, 5)`): two
/// digit runs joined by a single `/`. Returns `None` when there is none or a
/// run overflows `i64`.
pub fn attempt_fraction(text: &str) -> Option<(i64, i64)> {
    let bytes = text.as_bytes();
    for (slash, _) in text.match_indices('/') {
        let start = bytes[..slash]
            .iter()
            .rposition(|b| !b.is_ascii_digit())
            .map_or(0, |i| i + 1);
        let end = bytes[slash + 1..]
            .iter()
            .position(|b| !b.is_ascii_digit())
            .map_or(bytes.len(), |i| slash + 1 + i);
        if start == slash || end == slash + 1 {
            continue;
        }
        if let (Ok(n), Ok(m)) = (text[start..slash].parse(), text[slash + 1..end].parse()) {
            return Some((n, m));
        }
    }
    None
}

#[cfg(test)]
#[path = "retry_tests.rs"]
mod tests;
