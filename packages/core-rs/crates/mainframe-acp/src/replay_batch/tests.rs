use std::io::Read;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use flate2::read::ZlibDecoder;
use mainframe_types::acp::content::{ContentBlock, ContentChunk};
use mainframe_types::acp::update::{SessionState, SessionUpdate};
use serde_json::json;

use super::*;

fn chunk(i: usize) -> SessionUpdate {
    SessionUpdate::AgentMessageChunk(ContentChunk {
        message_id: format!("m{i}"),
        content: ContentBlock::Text {
            text: format!("text {i} ").repeat(20),
            meta: None,
        },
        meta: None,
    })
}

fn decode(data: &str) -> Vec<SessionUpdate> {
    let bytes = STANDARD.decode(data).expect("base64");
    let mut json = Vec::new();
    ZlibDecoder::new(bytes.as_slice())
        .read_to_end(&mut json)
        .expect("zlib");
    serde_json::from_slice(&json).expect("a JSON array of updates")
}

#[test]
fn a_replay_round_trips_through_batches_in_order() {
    let updates: Vec<SessionUpdate> = (0..REPLAY_BATCH_MAX_UPDATES + 3)
        .map(chunk)
        .chain(std::iter::once(SessionUpdate::StateUpdate(
            SessionState::Running,
        )))
        .collect();

    let notes = replay_batch_notifications("chat_1", &updates);
    assert_eq!(notes.len(), 2);
    let mut decoded = Vec::new();
    for note in &notes {
        assert_eq!(note.method, "_mainframe.dev/replay_batch");
        let params = note.params.as_ref().unwrap();
        assert_eq!(params["sessionId"], json!("chat_1"));
        assert_eq!(params["encoding"], json!(REPLAY_BATCH_ENCODING));
        let batch = decode(params["data"].as_str().unwrap());
        assert_eq!(params["count"], json!(batch.len()));
        decoded.extend(batch);
    }
    assert_eq!(decoded, updates);
    assert_eq!(
        notes[0].params.as_ref().unwrap()["count"],
        json!(REPLAY_BATCH_MAX_UPDATES)
    );
}

#[test]
fn an_empty_replay_sends_no_batch() {
    assert!(replay_batch_notifications("chat_1", &[]).is_empty());
}

#[test]
fn batches_are_much_smaller_than_the_frames_they_replace() {
    let updates: Vec<SessionUpdate> = (0..200).map(chunk).collect();
    let plain: usize = updates
        .iter()
        .map(|update| serde_json::to_string(update).unwrap().len())
        .sum();
    let batched: usize = replay_batch_notifications("chat_1", &updates)
        .iter()
        .map(|note| serde_json::to_string(note).unwrap().len())
        .sum();
    assert!(batched * 5 < plain, "plain {plain} vs batched {batched}");
}
