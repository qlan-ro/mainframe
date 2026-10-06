//! `resolve_fork_cut`: the id fast path, the ordinal fallback and every
//! refusal, in the order the daemon contract lists them.

use std::collections::HashMap;

use mainframe_types::chat::{ChatMessage, ChatMessageType};

use super::*;

fn msg(id: &str, r#type: ChatMessageType) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        chat_id: "c1".to_string(),
        r#type,
        content: Vec::new(),
        timestamp: String::new(),
        metadata: None,
    }
}

fn user(id: &str) -> ChatMessage {
    msg(id, ChatMessageType::User)
}

fn assistant(id: &str) -> ChatMessage {
    msg(id, ChatMessageType::Assistant)
}

fn with_meta(mut m: ChatMessage, key: &str, value: serde_json::Value) -> ChatMessage {
    m.metadata = Some(HashMap::from([(key.to_string(), value)]));
    m
}

fn conversation(ids: &[&str]) -> Vec<ChatMessage> {
    ids.iter()
        .flat_map(|id| [user(id), assistant(&format!("{id}-reply"))])
        .collect()
}

#[test]
fn the_id_fast_path_returns_the_same_id() {
    let live = conversation(&["u1", "u2", "u3"]);
    let disk = conversation(&["u1", "u2", "u3"]);
    assert_eq!(resolve_fork_cut(&live, &disk, "u2"), Ok("u2".to_string()));
}

#[test]
fn the_ordinal_fallback_maps_live_ids_to_disk_ids() {
    let live = conversation(&["live-1", "live-2", "live-3"]);
    let disk = conversation(&["disk-1", "disk-2", "disk-3"]);
    assert_eq!(
        resolve_fork_cut(&live, &disk, "live-3"),
        Ok("disk-3".to_string())
    );
}

#[test]
fn a_count_mismatch_is_unresolved() {
    let live = conversation(&["live-1", "live-2", "live-3"]);
    let disk = conversation(&["disk-1", "disk-2"]);
    assert_eq!(
        resolve_fork_cut(&live, &disk, "live-2"),
        Err(ForkChatError::ForkPointUnresolved(
            CUT_NOT_FOUND_REASON.to_string()
        ))
    );
}

#[test]
fn the_first_user_message_has_nothing_before_it() {
    let live = conversation(&["u1", "u2"]);
    assert_eq!(
        resolve_fork_cut(&live, &live, "u1"),
        Err(ForkChatError::NothingBeforeMessage)
    );
}

#[test]
fn queued_pending_and_failed_messages_are_not_sent() {
    let cases = [
        with_meta(user("u2"), "queued", serde_json::json!(true)),
        with_meta(user("u2"), "pending", serde_json::json!(true)),
        with_meta(user("u2"), "error", serde_json::json!("boom")),
    ];
    for unsent in cases {
        let live = vec![user("u1"), assistant("a1"), unsent];
        assert_eq!(
            resolve_fork_cut(&live, &live, "u2"),
            Err(ForkChatError::MessageNotSent)
        );
    }
}

#[test]
fn a_queued_message_does_not_count_toward_the_ordinal() {
    // The queued prompt isn't in the transcript yet, so counting it would
    // shift every later ordinal by one.
    let live = vec![
        user("live-1"),
        assistant("a1"),
        user("live-2"),
        with_meta(user("live-3"), "queued", serde_json::json!(true)),
    ];
    let disk = conversation(&["disk-1", "disk-2"]);
    assert_eq!(
        resolve_fork_cut(&live, &disk, "live-2"),
        Ok("disk-2".to_string())
    );
}

#[test]
fn a_non_user_id_is_refused() {
    let live = conversation(&["u1", "u2"]);
    assert_eq!(
        resolve_fork_cut(&live, &live, "u1-reply"),
        Err(ForkChatError::NotAUserMessage)
    );
}

#[test]
fn an_unknown_id_is_not_found() {
    let live = conversation(&["u1", "u2"]);
    assert_eq!(
        resolve_fork_cut(&live, &live, "nope"),
        Err(ForkChatError::MessageNotFound)
    );
}
