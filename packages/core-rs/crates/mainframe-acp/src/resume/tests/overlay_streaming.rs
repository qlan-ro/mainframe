//! Overlay-parity streaming attribution on resume replay (todo #382),
//! split out of `tests.rs` to keep that file under the 300-line limit — a
//! mid-stream snapshot's streaming leaf must land on only the last
//! replayed item, matching `encode_revision`'s own contract
//! (`encoder/tests/streaming_tests.rs`). Shares `tests.rs`'s fixtures
//! (`FakePort`, `dmsg`, `text`, `control_request`, `resume_request`) via
//! `use super::*`.

use mainframe_types::acp::update::MessageUpsert;
use mainframe_types::display::StreamingLeafKind;
use serde_json::json;

use super::*;

/// Reads `ItemMeta.streaming` back off a replayed `MessageUpsert`'s wire
/// `_meta` — `false` when the key (or the whole meta) is absent, matching
/// `encode`'s/a non-streaming `encode_revision`'s output.
fn upsert_streaming(upsert: &MessageUpsert) -> bool {
    upsert
        .meta
        .clone()
        .flatten()
        .and_then(|v| v.get(MAINFRAME_META_NAMESPACE).cloned())
        .and_then(|ns| ns.get("streaming").cloned())
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

#[tokio::test]
async fn a_text_streaming_snapshot_marks_only_the_last_agent_message_as_streaming() {
    let port = FakePort {
        messages: vec![
            dmsg("dmsg_1", vec![text("first")]),
            dmsg("dmsg_2", vec![text("second, still open")]),
        ],
        pending: None,
        running: true,
        streaming: Some(StreamingLeafKind::Text),
    };
    let (_response, replay) =
        dispatch_resume(resume_request(Some(json!({ "type": "start" }))), &port).await;

    let upserts: Vec<&MessageUpsert> = replay
        .updates
        .iter()
        .filter_map(|u| match u {
            SessionUpdate::AgentMessage(upsert) => Some(upsert),
            _ => None,
        })
        .collect();
    assert_eq!(upserts.len(), 2);
    assert!(
        !upsert_streaming(upserts[0]),
        "the earlier, closed message must not carry streaming"
    );
    assert!(
        upsert_streaming(upserts[1]),
        "the last message, still open, must carry streaming"
    );
}

#[tokio::test]
async fn a_thinking_streaming_snapshot_marks_only_the_open_thought() {
    let port = FakePort {
        messages: vec![dmsg("dmsg_1", vec![thinking("pondering")])],
        pending: None,
        running: true,
        streaming: Some(StreamingLeafKind::Thinking),
    };
    let (_response, replay) =
        dispatch_resume(resume_request(Some(json!({ "type": "start" }))), &port).await;

    let thought = replay
        .updates
        .iter()
        .find_map(|u| match u {
            SessionUpdate::AgentThought(upsert) => Some(upsert),
            _ => None,
        })
        .expect("a thinking leaf replays as an AgentThought");
    assert!(upsert_streaming(thought));
}

#[tokio::test]
async fn no_streaming_snapshot_replays_identically_to_the_pre_382_encode_based_path() {
    let messages = vec![
        dmsg("dmsg_1", vec![text("first")]),
        dmsg("dmsg_2", vec![thinking("hmm"), text("second")]),
    ];

    let streaming_port = FakePort {
        messages: messages.clone(),
        pending: None,
        running: false,
        streaming: None,
    };
    let (streaming_response, streaming_replay) = dispatch_resume(
        resume_request(Some(json!({ "type": "start" }))),
        &streaming_port,
    )
    .await;

    // The pre-#382 path: `encoder::encode` fed straight into the same replay
    // machinery, with no streaming-aware port at all.
    let items = crate::encoder::encode(&messages);
    let mut state = crate::session_state::SessionState::new();
    let mut expected_updates = state.diff(&items);
    expected_updates.push(turn_state_update(false));

    assert_eq!(streaming_replay.updates, expected_updates);
    let mainframe_types::acp::jsonrpc::JsonRpcOutcome::Result { result } =
        streaming_response.outcome
    else {
        panic!("expected a success response");
    };
    assert_eq!(
        result["_meta"][MAINFRAME_META_NAMESPACE]["itemCount"],
        json!(items.len()),
        "itemCount is unaffected by the overlay-parity change"
    );
}

#[tokio::test]
async fn an_open_gate_still_redelivers_alongside_a_streaming_snapshot() {
    let port = FakePort {
        messages: vec![dmsg("dmsg_1", vec![text("hello")])],
        pending: Some(control_request("req_1")),
        running: true,
        streaming: Some(StreamingLeafKind::Text),
    };
    let (_response, replay) = dispatch_resume(resume_request(None), &port).await;

    let request = replay
        .pending_permission_request
        .expect("open gate must be redelivered even with a streaming overlay present");
    assert_eq!(request.method, "session/request_permission");
}
