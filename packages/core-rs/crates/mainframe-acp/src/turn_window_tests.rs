use super::*;
use serde_json::{Value, json};

fn msg(id: &str, kind: &str, text: &str, meta: Value) -> DisplayMessage {
    serde_json::from_value(json!({
        "id": id, "chatId": "chat", "type": kind, "timestamp": "now",
        "content": [{"type": "text", "text": text}],
        "metadata": meta,
    }))
    .unwrap()
}

fn user(id: &str) -> DisplayMessage {
    msg(id, "user", id, json!({}))
}

fn reply(id: &str) -> DisplayMessage {
    msg(id, "assistant", id, json!({}))
}

fn marker(id: &str) -> DisplayMessage {
    serde_json::from_value(json!({
        "id": id, "chatId": "chat", "type": "system", "timestamp": "now",
        "content": [{"type": "compaction"}],
    }))
    .unwrap()
}

fn ids(messages: &[DisplayMessage], start: usize) -> Vec<&str> {
    messages[start..].iter().map(|m| m.id.as_str()).collect()
}

fn conversation() -> Vec<DisplayMessage> {
    vec![
        user("u1"),
        reply("a1"),
        user("u2"),
        reply("a2"),
        reply("a2b"),
        user("u3"),
        reply("a3"),
    ]
}

#[test]
fn a_window_of_turns_starts_at_a_user_message() {
    let messages = conversation();
    for (turns, first) in [(1, "u3"), (2, "u2"), (3, "u1"), (9, "u1")] {
        let start = start_before(&messages, messages.len(), turns);
        assert_eq!(messages[start].id, first, "turns = {turns}");
    }
}

#[test]
fn a_queued_prompt_is_not_a_turn_and_a_running_turn_is() {
    let mut messages = conversation();
    messages.push(msg("q1", "user", "queued", json!({"queued": true})));
    // `a3` is still running and counts as the newest turn.
    let start = start_before(&messages, messages.len(), 1);
    assert_eq!(ids(&messages, start), ["u3", "a3", "q1"]);
    assert_eq!(count_turns(&messages), 3);
}

#[test]
fn a_steered_prompt_continues_its_turn() {
    let mut messages = conversation();
    messages.insert(4, msg("s1", "user", "steer", json!({"steered": true})));
    let start = start_before(&messages, messages.len(), 2);
    assert_eq!(messages[start].id, "u2");
    assert_eq!(count_turns(&messages), 3);
}

#[test]
fn a_hidden_prompt_group_starts_a_turn() {
    let mut messages = conversation();
    messages.push(msg(
        "h1",
        "assistant",
        "task done",
        json!({"hiddenPromptEvent": "Background task finished", "turnGroup": "g2"}),
    ));
    messages.push(reply("h1b"));
    let start = start_before(&messages, messages.len(), 2);
    assert_eq!(ids(&messages, start), ["u3", "a3", "h1", "h1b"]);
    // A reply whose known group changes under an assistant container also starts one.
    let mut grouped = vec![
        user("u"),
        msg("x", "assistant", "x", json!({"turnGroup": "g1"})),
    ];
    grouped.push(msg("y", "assistant", "y", json!({"turnGroup": "g2"})));
    assert_eq!(count_turns(&grouped), 2);
}

#[test]
fn a_compaction_marker_goes_with_the_turn_after_it() {
    let mut messages = conversation();
    messages.insert(5, marker("c1"));
    let start = start_before(&messages, messages.len(), 1);
    assert_eq!(ids(&messages, start), ["c1", "u3", "a3"]);
    let earlier = start_before(&messages, 5, 1);
    assert_eq!(ids(&messages, earlier)[..2], ["u2", "a2"]);
}

#[test]
fn paging_counts_from_the_floor() {
    let messages = conversation();
    let start = start_before(&messages, 5, 1);
    assert_eq!(messages[start].id, "u2");
    assert_eq!(start_before(&messages, 2, 5), 0);
    assert_eq!(start_before(&messages, 0, 3), 0);
}

fn big(id: &str, kind: &str, bytes: usize) -> DisplayMessage {
    msg(id, kind, &"x".repeat(bytes), json!({}))
}

fn encoded(messages: &[DisplayMessage]) -> Vec<Vec<EncodedItem>> {
    crate::history_window::encode_range(messages, None, 0, messages.len())
}

#[test]
fn the_size_guard_drops_whole_turns_from_the_top() {
    let messages = vec![
        user("u1"),
        big("a1", "assistant", 400),
        user("u2"),
        big("a2", "assistant", 400),
        user("u3"),
        big("a3", "assistant", 400),
    ];
    let mut containers = encoded(&messages);
    let each = encoded_bytes(&containers[2]) + encoded_bytes(&containers[3]);
    let start = fit(&messages, 0, &mut containers, each * 2 + 10);
    assert_eq!((start, containers.len()), (2, 4));
    let mut all = encoded(&messages);
    assert_eq!(fit(&messages, 0, &mut all, usize::MAX), 0);
    assert_eq!(all.len(), 6);
}

#[test]
fn the_size_guard_keeps_one_turn_even_when_it_alone_is_too_big() {
    let messages = vec![
        user("u1"),
        big("a1", "assistant", 100),
        user("u2"),
        big("a2", "assistant", 5_000),
        reply("a2b"),
    ];
    let mut containers = encoded(&messages);
    let start = fit(&messages, 0, &mut containers, 1_000);
    assert_eq!(start, 2);
    assert_eq!(containers.len(), 3);
    let mut single = encoded(&messages[2..]);
    assert_eq!(fit(&messages, 2, &mut single, 10), 2);
    assert_eq!(single.len(), 3);
}

#[test]
fn the_size_guard_keeps_a_marker_with_the_turn_it_leads() {
    let messages = vec![
        user("u1"),
        big("a1", "assistant", 4_000),
        marker("c1"),
        user("u2"),
        reply("a2"),
    ];
    let mut containers = encoded(&messages);
    let start = fit(&messages, 0, &mut containers, 600);
    assert_eq!(messages[start].id, "c1");
}
