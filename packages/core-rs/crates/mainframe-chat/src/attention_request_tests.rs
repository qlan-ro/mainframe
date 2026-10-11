use super::*;

#[test]
fn normalize_empty_and_whitespace_only_is_none() {
    assert_eq!(normalize_attention_body(""), None);
    assert_eq!(normalize_attention_body("   \n\t "), None);
}

#[test]
fn normalize_truncates_long_message() {
    let long = "a".repeat(250);
    let normalized = normalize_attention_body(&long).unwrap();
    assert_eq!(normalized.body.chars().count(), 200);
    assert!(normalized.body.ends_with('\u{2026}'));
    assert_eq!(normalized.dedupe_key, long);
}

#[test]
fn normalize_leaves_200_chars_untouched() {
    let exact = "a".repeat(200);
    let normalized = normalize_attention_body(&exact).unwrap();
    assert_eq!(normalized.body, exact);
    assert_eq!(normalized.dedupe_key, exact);
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
