//! Pure normalization + dedupe for Claude's `PushNotification` tool call. Kept
//! independent of the event handler so the rules — trim, empty check, truncation, and
//! per-session dedupe — exist in exactly one place.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::event_handler::truncate_push_body;

/// A repeat of the same `(chat_id, exact message text)` inside this window
/// is suppressed.
pub const ATTENTION_DEDUPE_WINDOW: Duration = Duration::from_secs(60);

/// The trimmed-but-untruncated dedupe key alongside the display body (the 60s
/// window keys on exact message text, not the truncated body that ships in the
/// notification).
#[derive(Debug, PartialEq, Eq)]
pub struct NormalizedAttention {
    pub dedupe_key: String,
    pub body: String,
}

/// Trim the raw tool-call message and truncate it for push/OS delivery;
/// `None` when nothing is left after trimming.
pub(crate) fn normalize_attention_body(raw: &str) -> Option<NormalizedAttention> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(NormalizedAttention {
        dedupe_key: trimmed.to_string(),
        body: truncate_push_body(trimmed),
    })
}

/// Per-(chat, exact message text) admission window. Lives on `EventHandler`,
/// not the per-session sink, so it survives a session resume.
#[derive(Default)]
pub struct AttentionDedupe {
    seen: HashMap<(String, String), Instant>,
}

impl AttentionDedupe {
    /// `true` when this message should raise a notification now; `false` when
    /// the same chat + exact message text was already admitted within
    /// [`ATTENTION_DEDUPE_WINDOW`]. `key` must be the untruncated message so
    /// two texts sharing a truncated prefix don't collide.
    pub fn admit(&mut self, chat_id: &str, key: &str, now: Instant) -> bool {
        self.seen
            .retain(|_, seen_at| now.duration_since(*seen_at) < ATTENTION_DEDUPE_WINDOW);
        let cache_key = (chat_id.to_string(), key.to_string());
        if self.seen.contains_key(&cache_key) {
            return false;
        }
        self.seen.insert(cache_key, now);
        true
    }
}

#[cfg(test)]
#[path = "attention_request_tests.rs"]
mod tests;
