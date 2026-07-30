//! Pure normalization + dedupe for Claude's `PushNotification` tool call
//! (todo #293). Kept free of `EventHandlerDeps` so the rules — trim, empty
//! check, truncation, and per-session dedupe — exist in exactly one place
//! (plan decision P2).

use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::event_handler::truncate_push_body;

/// A repeat of the same `(chat_id, body)` inside this window is suppressed.
pub const ATTENTION_DEDUPE_WINDOW: Duration = Duration::from_secs(60);

/// Trim the raw tool-call message and truncate it for push/OS delivery;
/// `None` when nothing is left after trimming.
pub fn normalize_attention_body(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(truncate_push_body(trimmed))
}

/// Per-(chat, body) admission window. Lives on `EventHandler`, not the
/// per-session sink, so it survives a session resume (plan decision P3).
#[derive(Default)]
pub struct AttentionDedupe {
    seen: HashMap<(String, String), Instant>,
}

impl AttentionDedupe {
    /// `true` when this message should raise a notification now; `false`
    /// when the same chat + body was already admitted within
    /// [`ATTENTION_DEDUPE_WINDOW`].
    pub fn admit(&mut self, chat_id: &str, body: &str, now: Instant) -> bool {
        self.seen
            .retain(|_, seen_at| now.duration_since(*seen_at) < ATTENTION_DEDUPE_WINDOW);
        let key = (chat_id.to_string(), body.to_string());
        if self.seen.contains_key(&key) {
            return false;
        }
        self.seen.insert(key, now);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_empty_and_whitespace_only_is_none() {
        assert_eq!(normalize_attention_body(""), None);
        assert_eq!(normalize_attention_body("   \n\t "), None);
    }

    #[test]
    fn normalize_truncates_long_message() {
        let long = "a".repeat(250);
        let body = normalize_attention_body(&long).unwrap();
        assert_eq!(body.chars().count(), 200);
        assert!(body.ends_with('\u{2026}'));
    }

    #[test]
    fn normalize_leaves_200_chars_untouched() {
        let exact = "a".repeat(200);
        assert_eq!(normalize_attention_body(&exact).unwrap(), exact);
    }

    #[test]
    fn dedupe_admits_same_message_once_within_window() {
        let mut dedupe = AttentionDedupe::default();
        let t = Instant::now();
        assert!(dedupe.admit("chat-1", "hello", t));
        assert!(!dedupe.admit("chat-1", "hello", t + Duration::from_secs(59)));
    }

    #[test]
    fn dedupe_admits_again_after_window_elapses() {
        let mut dedupe = AttentionDedupe::default();
        let t = Instant::now();
        assert!(dedupe.admit("chat-1", "hello", t));
        assert!(dedupe.admit("chat-1", "hello", t + Duration::from_secs(61)));
    }

    #[test]
    fn dedupe_admits_different_messages_back_to_back() {
        let mut dedupe = AttentionDedupe::default();
        let t = Instant::now();
        assert!(dedupe.admit("chat-1", "hello", t));
        assert!(dedupe.admit("chat-1", "world", t));
    }

    #[test]
    fn dedupe_admits_same_message_in_different_chats() {
        let mut dedupe = AttentionDedupe::default();
        let t = Instant::now();
        assert!(dedupe.admit("chat-1", "hello", t));
        assert!(dedupe.admit("chat-2", "hello", t));
    }
}
