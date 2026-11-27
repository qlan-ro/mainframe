use super::*;
use serde_json::{Value, json};

fn text(id: &str) -> Value {
    json!([{"type": "text", "text": id}])
}

fn system_msg(id: &str, content: Value) -> DisplayMessage {
    serde_json::from_value(json!({
        "id": id, "chatId": "chat", "type": "system", "timestamp": "now", "content": content,
    }))
    .unwrap()
}

fn msg(id: &str, kind: &str, meta: Value) -> DisplayMessage {
    serde_json::from_value(json!({
        "id": id, "chatId": "chat", "type": kind, "timestamp": "now",
        "content": text(id), "metadata": meta,
    }))
    .unwrap()
}

fn user(id: &str) -> DisplayMessage {
    msg(id, "user", json!({}))
}

fn reply(id: &str) -> DisplayMessage {
    msg(id, "assistant", json!({}))
}

fn marker(id: &str) -> DisplayMessage {
    system_msg(id, json!([{"type": "compaction"}]))
}

fn skill(id: &str) -> DisplayMessage {
    system_msg(
        id,
        json!([{"type": "skill_loaded", "skillName": "s", "path": "p", "content": "c"}]),
    )
}

fn error(id: &str) -> DisplayMessage {
    serde_json::from_value(json!({
        "id": id, "chatId": "chat", "type": "error", "timestamp": "now",
        "content": [{"type": "error", "message": "boom"}],
    }))
    .unwrap()
}

fn hidden(id: &str, group: &str) -> DisplayMessage {
    msg(
        id,
        "assistant",
        json!({"turnGroup": group, "hiddenPromptEvent": "Task finished"}),
    )
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
fn a_window_of_turns_starts_at_a_turn_start() {
    let messages = conversation();
    let index = TurnIndex::new(&messages);
    for (turns, first) in [(1, "u3"), (2, "u2"), (3, "u1"), (9, "u1")] {
        let start = index.start_before(messages.len(), turns);
        assert_eq!(messages[start].id, first, "turns = {turns}");
    }
}

#[test]
fn a_queued_prompt_is_not_a_turn_and_a_running_turn_is() {
    let mut messages = conversation();
    messages.push(msg("q1", "user", json!({"queued": true})));
    let index = TurnIndex::new(&messages);
    let start = index.start_before(messages.len(), 1);
    assert_eq!(ids(&messages, start), ["u3", "a3", "q1"]);
    assert_eq!(index.count(), 3);
}

#[test]
fn a_hidden_prompt_reply_split_by_system_error_or_steered_containers_stays_in_its_turn() {
    let messages = vec![
        user("u1"),
        msg("a1", "assistant", json!({"turnGroup": "g1"})),
        hidden("h1", "g2"),
        skill("k1"),
        hidden("h2", "g2"),
        error("e1"),
        hidden("h3", "g2"),
        msg("s1", "user", json!({"steered": true})),
        hidden("h4", "g2"),
    ];
    let index = TurnIndex::new(&messages);
    assert_eq!(index.count(), 1);
    assert_eq!(index.start_before(messages.len(), 1), 0);
}

#[test]
fn steered_and_queued_prompts_are_not_boundaries() {
    let mut messages = conversation();
    messages.insert(4, msg("s1", "user", json!({"steered": true})));
    messages.push(msg("q1", "user", json!({"queued": true})));
    let index = TurnIndex::new(&messages);
    assert_eq!(index.count(), 3);
    assert_eq!(messages[index.start_before(messages.len(), 2)].id, "u2");
}

#[test]
fn markers_lead_the_turn_after_them() {
    let mut messages = conversation();
    messages.insert(5, marker("c1"));
    let index = TurnIndex::new(&messages);
    let start = index.start_before(messages.len(), 1);
    assert_eq!(ids(&messages, start), ["c1", "u3", "a3"]);
    let earlier = index.start_before(5, 1);
    assert_eq!(ids(&messages, earlier)[..2], ["u2", "a2"]);
}

#[test]
fn paging_counts_from_the_floor_and_a_mid_turn_floor_is_free() {
    let messages = conversation();
    let index = TurnIndex::new(&messages);
    let start = index.start_before(5, 1);
    assert_eq!(messages[start].id, "u2");
    assert_eq!(index.start_before(2, 5), 0);
    assert_eq!(index.start_before(0, 3), 0);
    // The floor sits on `a2b`, inside the turn that starts at `u2`: that
    // partial turn comes along and the next turn back is the one counted.
    assert_eq!(messages[index.start_before(4, 1)].id, "u1");
    assert_eq!(index.start_before(4, 2), 0);
}

fn big(id: &str, kind: &str, bytes: usize) -> DisplayMessage {
    msg(id, kind, json!({})).tap(|m| {
        m.content =
            serde_json::from_value(json!([{"type": "text", "text": "x".repeat(bytes)}])).unwrap();
    })
}

trait Tap: Sized {
    fn tap(mut self, f: impl FnOnce(&mut Self)) -> Self {
        f(&mut self);
        self
    }
}
impl Tap for DisplayMessage {}

fn encoded(messages: &[DisplayMessage]) -> Vec<Vec<EncodedItem>> {
    crate::history_window::encode_range(messages, None, 0, messages.len())
}

fn wire(messages: &[DisplayMessage]) -> Wire {
    Wire::new(true, true, messages.len())
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
    let index = TurnIndex::new(&messages);
    let mut containers = encoded(&messages);
    let each = wire(&messages).bytes(2, &containers[2]) + wire(&messages).bytes(3, &containers[3]);
    let start = index.fit(0, &mut containers, &wire(&messages), each * 2 + 10);
    assert_eq!((start, containers.len()), (2, 4));
    let mut all = encoded(&messages);
    assert_eq!(index.fit(0, &mut all, &wire(&messages), usize::MAX), 0);
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
    let index = TurnIndex::new(&messages);
    let mut containers = encoded(&messages);
    assert_eq!(index.fit(0, &mut containers, &wire(&messages), 1_000), 2);
    assert_eq!(containers.len(), 3);
    let mut single = encoded(&messages[2..]);
    assert_eq!(index.fit(2, &mut single, &wire(&messages), 10), 2);
    assert_eq!(single.len(), 3);
}

#[test]
fn the_size_guard_drops_a_marker_together_with_its_turn() {
    let messages = vec![
        user("u1"),
        big("a1", "assistant", 4_000),
        marker("c1"),
        user("u2"),
        reply("a2"),
        user("u3"),
        reply("a3"),
    ];
    let index = TurnIndex::new(&messages);
    // Starting at the marker that leads u2, the first unit to go is c1 + u2 + a2.
    let mut containers = encoded(&messages[2..]);
    let start = index.fit(2, &mut containers, &wire(&messages), 10);
    assert_eq!(messages[start].id, "u3");
    let mut containers = encoded(&messages);
    let kept: usize = (2..7)
        .map(|i| wire(&messages).bytes(i, &containers[i]))
        .sum();
    let start = index.fit(0, &mut containers, &wire(&messages), kept + 10);
    assert_eq!(messages[start].id, "c1");
}

fn tool_call_with_image(id: &str, image_bytes: usize, text_bytes: usize) -> EncodedItem {
    serde_json::from_value(json!({"ToolCall": {
        "id": id, "title": "Read", "kind": "read", "status": "completed", "raw_input": null,
        "content": [
            {"type": "content", "content": {"type": "text", "text": "r".repeat(text_bytes)}},
            {"type": "content", "content": {"type": "image", "data": "A".repeat(image_bytes), "mimeType": "image/png"}},
        ],
        "meta": null}}))
    .unwrap()
}

#[test]
fn the_size_guard_measures_what_is_sent_not_the_full_images_and_results() {
    let item = tool_call_with_image("t", 400_000, 100_000);
    let full = encoded_bytes(&item);
    assert!(full > 500_000);
    // The newest containers keep their results but a lazy image is a reference.
    let newest = Wire::new(true, true, 1).bytes(0, std::slice::from_ref(&item));
    assert!((100_000..110_000).contains(&newest), "{newest}");
    // An old container also has its result cut to a preview.
    let old = Wire::new(true, true, 100).bytes(0, std::slice::from_ref(&item));
    assert!(old < 4_000, "{old}");
    // Without previews the result stays whole.
    let plain = Wire::new(false, true, 100).bytes(0, std::slice::from_ref(&item));
    assert!((100_000..110_000).contains(&plain), "{plain}");
}

#[test]
fn a_single_oversized_turn_is_sent_whole_even_with_hidden_replies_inside() {
    let messages = vec![
        user("u1"),
        big("a1", "assistant", 5_000),
        hidden("h1", "g2"),
        big("h2", "assistant", 5_000),
        hidden("h3", "g3"),
    ];
    let mut containers = encoded(&messages);
    let index = TurnIndex::new(&messages);
    assert_eq!(index.fit(0, &mut containers, &wire(&messages), 100), 0);
    assert_eq!(containers.len(), 5);
}

#[path = "turn_window_tests_more.rs"]
mod more;
