//! `item/agentMessage/delta` streams through the partial overlay.
//! Growing-text and completion-parity cases replay the real capture
//! (`agent-message-delta-0.155.1.jsonl`, codex-cli 0.155.1); every guard case
//! (child/unknown thread, stale turn, already-completed item, malformed
//! payload, teardown) is built from small synthetic notifications so each
//! assertion pins one condition without depending on the capture's exact
//! shape.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use common::{Recorder, capture_path, replay_capture, temp_registry};
use mainframe_adapter_codex::event_mapper::{CodexSessionState, handle_notification};
use serde_json::{Value, json};

const THREAD: &str = "thread-parent-1";
const TURN_A: &str = "turn-a";
const TURN_B: &str = "turn-b";
const ITEM_1: &str = "msg_1";
const ITEM_2: &str = "msg_2";

fn thread_started(thread_id: &str) -> Value {
    json!({ "thread": { "id": thread_id } })
}

fn turn_started(thread_id: &str, turn_id: &str) -> Value {
    json!({ "threadId": thread_id, "turn": { "id": turn_id } })
}

fn turn_completed(thread_id: &str, turn_id: &str, status: &str) -> Value {
    json!({
        "threadId": thread_id,
        "turn": { "id": turn_id, "status": status, "items": [], "error": null }
    })
}

fn delta(thread_id: &str, turn_id: &str, item_id: &str, text: &str) -> Value {
    json!({ "threadId": thread_id, "turnId": turn_id, "itemId": item_id, "delta": text })
}

fn agent_message_item(id: &str, text: &str) -> Value {
    json!({ "type": "agentMessage", "id": id, "text": text })
}

fn item_completed(thread_id: &str, turn_id: &str, item: Value) -> Value {
    json!({ "threadId": thread_id, "turnId": turn_id, "item": item })
}

/// A fresh state + recorder with `emit_interval_ms` zeroed, so every emitted
/// delta records a partial (tests drive deltas back-to-back, and a real
/// interval would gate most of them).
fn fresh() -> (Recorder, CodexSessionState) {
    let rec = Recorder::new();
    let mut state = CodexSessionState::default();
    state.agent_message_partial.emit_interval_ms = 0;
    (rec, state)
}

fn send(method: &str, params: &Value, rec: &Recorder, state: &mut CodexSessionState) {
    handle_notification(method, params, &rec.sink(), state);
}

#[test]
fn replaying_the_fixture_streams_growing_text_under_the_completed_item_id() {
    let rec = Recorder::new();
    let mut state = CodexSessionState::default();
    state.agent_message_partial.emit_interval_ms = 0;
    replay_capture(
        &capture_path("agent-message-delta-0.155.1.jsonl"),
        &rec,
        &mut state,
    );

    let partials = rec.partials();
    assert!(
        partials.len() > 5,
        "expected multiple partials, got {}",
        partials.len()
    );

    let item_id = "msg_09af3cd1fb9af459016ac02d5e043c87d295dc51cb4308f1b8";
    let texts: Vec<String> = partials
        .iter()
        .map(|(id, content)| {
            assert_eq!(
                id, item_id,
                "every partial keys under the completed item id"
            );
            text_of(content)
        })
        .collect();
    for pair in texts.windows(2) {
        assert!(
            pair[1].len() > pair[0].len() && pair[1].starts_with(&pair[0]),
            "text must grow monotonically: {:?} -> {:?}",
            pair[0],
            pair[1]
        );
    }

    let completed_text = "Rivers flow downhill toward the sea every single day.";
    assert_eq!(texts.last().unwrap(), completed_text);

    let messages = rec.messages();
    assert_eq!(messages.len(), 1);
    assert_eq!(text_of(&messages[0]), completed_text);
    assert_eq!(
        rec.message_vendor_ids(),
        vec![Some(item_id.to_string())],
        "the completed on_message carries the same vendor id the partials used"
    );
}

#[test]
fn completion_with_no_deltas_records_zero_partials() {
    let (rec, mut state) = fresh();
    send("thread/started", &thread_started(THREAD), &rec, &mut state);
    send(
        "turn/started",
        &turn_started(THREAD, TURN_A),
        &rec,
        &mut state,
    );
    send(
        "item/completed",
        &item_completed(THREAD, TURN_A, agent_message_item(ITEM_1, "Hi there")),
        &rec,
        &mut state,
    );

    assert!(rec.partials().is_empty());
    assert_eq!(rec.messages().len(), 1);
    assert_eq!(text_of(&rec.messages()[0]), "Hi there");
}

#[test]
fn a_child_threads_delta_is_dropped_and_its_card_renders_unaffected() {
    let rec = Recorder::new();
    let (_dir, deps) = temp_registry(&[]);
    let mut state = CodexSessionState {
        registry_deps: Some(deps),
        ..CodexSessionState::default()
    };
    state.agent_message_partial.emit_interval_ms = 0;
    replay_capture(
        &capture_path("collab-delegation-0.144.3.jsonl"),
        &rec,
        &mut state,
    );
    let card_id = "call_4Sektr7DEdLzGCaKGNEcUVl4";
    let child_thread = state
        .thread_for_card(card_id)
        .expect("the delegation capture registers a child thread for this card");

    send(
        "item/agentMessage/delta",
        &delta(&child_thread, "some-turn", "msg_child", "leaking text"),
        &rec,
        &mut state,
    );

    assert!(
        rec.partials().is_empty(),
        "a child thread's delta must never reach the parent overlay"
    );
}

#[test]
fn an_unknown_threads_delta_is_dropped() {
    let (rec, mut state) = fresh();
    send("thread/started", &thread_started(THREAD), &rec, &mut state);
    send(
        "turn/started",
        &turn_started(THREAD, TURN_A),
        &rec,
        &mut state,
    );
    send(
        "item/agentMessage/delta",
        &delta("unregistered-thread", TURN_A, ITEM_1, "hi"),
        &rec,
        &mut state,
    );
    assert!(rec.partials().is_empty());
}

#[test]
fn a_delta_for_a_previous_turn_after_a_new_turn_started_is_dropped() {
    let (rec, mut state) = fresh();
    send("thread/started", &thread_started(THREAD), &rec, &mut state);
    send(
        "turn/started",
        &turn_started(THREAD, TURN_A),
        &rec,
        &mut state,
    );
    send(
        "item/agentMessage/delta",
        &delta(THREAD, TURN_A, ITEM_1, "Hello"),
        &rec,
        &mut state,
    );
    assert_eq!(rec.partials().len(), 1);

    send(
        "turn/started",
        &turn_started(THREAD, TURN_B),
        &rec,
        &mut state,
    );
    send(
        "item/agentMessage/delta",
        &delta(THREAD, TURN_A, ITEM_1, " stale"),
        &rec,
        &mut state,
    );
    assert_eq!(
        rec.partials().len(),
        1,
        "a delta for the superseded turn must not emit"
    );
}

#[test]
fn a_delta_after_turn_completed_is_dropped() {
    let (rec, mut state) = fresh();
    send("thread/started", &thread_started(THREAD), &rec, &mut state);
    send(
        "turn/started",
        &turn_started(THREAD, TURN_A),
        &rec,
        &mut state,
    );
    send(
        "item/agentMessage/delta",
        &delta(THREAD, TURN_A, ITEM_1, "Hello"),
        &rec,
        &mut state,
    );
    assert_eq!(rec.partials().len(), 1);

    send(
        "turn/completed",
        &turn_completed(THREAD, TURN_A, "completed"),
        &rec,
        &mut state,
    );
    send(
        "item/agentMessage/delta",
        &delta(THREAD, TURN_A, ITEM_1, " late"),
        &rec,
        &mut state,
    );
    assert_eq!(
        rec.partials().len(),
        1,
        "a delta after turn/completed must not emit"
    );
}

#[test]
fn a_delta_for_an_already_completed_item_is_dropped() {
    let (rec, mut state) = fresh();
    send("thread/started", &thread_started(THREAD), &rec, &mut state);
    send(
        "turn/started",
        &turn_started(THREAD, TURN_A),
        &rec,
        &mut state,
    );
    send(
        "item/agentMessage/delta",
        &delta(THREAD, TURN_A, ITEM_1, "Hello"),
        &rec,
        &mut state,
    );
    send(
        "item/completed",
        &item_completed(THREAD, TURN_A, agent_message_item(ITEM_1, "Hello world")),
        &rec,
        &mut state,
    );
    assert_eq!(rec.partials().len(), 1);
    assert_eq!(rec.messages().len(), 1);

    send(
        "item/agentMessage/delta",
        &delta(THREAD, TURN_A, ITEM_1, " again"),
        &rec,
        &mut state,
    );
    assert_eq!(
        rec.partials().len(),
        1,
        "a duplicate delta for a completed item must not emit"
    );
}

#[test]
fn malformed_payloads_are_dropped_without_panicking() {
    let (rec, mut state) = fresh();
    send("thread/started", &thread_started(THREAD), &rec, &mut state);
    send(
        "turn/started",
        &turn_started(THREAD, TURN_A),
        &rec,
        &mut state,
    );

    send(
        "item/agentMessage/delta",
        &json!({ "threadId": THREAD, "turnId": TURN_A, "delta": "no item id" }),
        &rec,
        &mut state,
    );
    send(
        "item/agentMessage/delta",
        &json!({ "threadId": THREAD, "turnId": TURN_A, "itemId": ITEM_1, "delta": 42 }),
        &rec,
        &mut state,
    );
    send(
        "item/agentMessage/delta",
        &delta(THREAD, TURN_A, "", "hi"),
        &rec,
        &mut state,
    );

    assert!(rec.partials().is_empty());
}

#[test]
fn a_second_item_in_the_same_turn_starts_from_empty_text() {
    let (rec, mut state) = fresh();
    send("thread/started", &thread_started(THREAD), &rec, &mut state);
    send(
        "turn/started",
        &turn_started(THREAD, TURN_A),
        &rec,
        &mut state,
    );
    send(
        "item/agentMessage/delta",
        &delta(THREAD, TURN_A, ITEM_1, "Hi"),
        &rec,
        &mut state,
    );
    send(
        "item/completed",
        &item_completed(THREAD, TURN_A, agent_message_item(ITEM_1, "Hi")),
        &rec,
        &mut state,
    );
    send(
        "item/agentMessage/delta",
        &delta(THREAD, TURN_A, ITEM_2, "Bye"),
        &rec,
        &mut state,
    );

    let partials = rec.partials();
    let (id, content) = partials.last().expect("second item emitted a partial");
    assert_eq!(id, ITEM_2);
    assert_eq!(text_of(content), "Bye", "must not carry over item 1's text");
}

#[test]
fn a_large_interval_only_emits_the_first_delta_of_a_burst() {
    let rec = Recorder::new();
    let mut state = CodexSessionState::default();
    state.agent_message_partial.emit_interval_ms = 60_000;
    send("thread/started", &thread_started(THREAD), &rec, &mut state);
    send(
        "turn/started",
        &turn_started(THREAD, TURN_A),
        &rec,
        &mut state,
    );
    send(
        "item/agentMessage/delta",
        &delta(THREAD, TURN_A, ITEM_1, "a"),
        &rec,
        &mut state,
    );
    send(
        "item/agentMessage/delta",
        &delta(THREAD, TURN_A, ITEM_1, "b"),
        &rec,
        &mut state,
    );
    assert_eq!(
        rec.partials().len(),
        1,
        "the burst's later deltas sit inside the gate"
    );

    // The suppressed deltas were not lost — completion carries the full text.
    send(
        "item/completed",
        &item_completed(THREAD, TURN_A, agent_message_item(ITEM_1, "ab")),
        &rec,
        &mut state,
    );
    assert_eq!(text_of(&rec.messages()[0]), "ab");
}

#[test]
fn clear_transient_discards_in_flight_text_so_a_later_delta_starts_fresh() {
    let (rec, mut state) = fresh();
    send("thread/started", &thread_started(THREAD), &rec, &mut state);
    send(
        "turn/started",
        &turn_started(THREAD, TURN_A),
        &rec,
        &mut state,
    );
    send(
        "item/agentMessage/delta",
        &delta(THREAD, TURN_A, ITEM_1, "Hello"),
        &rec,
        &mut state,
    );
    assert_eq!(text_of(&rec.partials()[0].1), "Hello");

    // Simulates kill()/on_exit — clears in-flight state without touching
    // current_turn_id (interrupt/turn-completed own that).
    state.clear_transient();

    send(
        "item/agentMessage/delta",
        &delta(THREAD, TURN_A, ITEM_1, "World"),
        &rec,
        &mut state,
    );
    let last = rec.partials().last().unwrap().1.clone();
    assert_eq!(
        text_of(&last),
        "World",
        "no residual text survives clear_transient"
    );
}

#[test]
fn turn_completed_interrupted_or_failed_releases_partial_state() {
    for status in ["interrupted", "failed"] {
        let (rec, mut state) = fresh();
        send("thread/started", &thread_started(THREAD), &rec, &mut state);
        send(
            "turn/started",
            &turn_started(THREAD, TURN_A),
            &rec,
            &mut state,
        );
        send(
            "item/agentMessage/delta",
            &delta(THREAD, TURN_A, ITEM_1, "Hello"),
            &rec,
            &mut state,
        );
        assert_eq!(rec.partials().len(), 1);

        send(
            "turn/completed",
            &turn_completed(THREAD, TURN_A, status),
            &rec,
            &mut state,
        );
        send(
            "item/agentMessage/delta",
            &delta(THREAD, TURN_A, ITEM_1, " late"),
            &rec,
            &mut state,
        );
        assert_eq!(
            rec.partials().len(),
            1,
            "status {status}: a later delta for that turn must record nothing"
        );
    }
}

fn text_of(content: &[mainframe_types::chat::MessageContent]) -> String {
    use mainframe_types::chat::MessageContent;
    use mainframe_types::content::LeafContent;
    content
        .iter()
        .filter_map(|c| match c {
            MessageContent::Leaf(LeafContent::Text { text, .. }) => Some(text.as_str()),
            _ => None,
        })
        .collect()
}
