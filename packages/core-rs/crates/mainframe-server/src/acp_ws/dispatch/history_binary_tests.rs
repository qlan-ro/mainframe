use serde_json::{Value, json};

use super::tests::{call_with, chat_with_history};

fn inflate(payload: &[u8]) -> Vec<Value> {
    use std::io::Read;
    let mut text = String::new();
    flate2::read::ZlibDecoder::new(payload)
        .read_to_string(&mut text)
        .unwrap();
    serde_json::from_str(&text).unwrap()
}

/// `history_around` over binary frames carries the same updates the base64
/// batches carry, and a client that did not opt in sees only the old form.
#[tokio::test]
async fn history_around_frames_match_the_batches_an_old_client_gets() {
    let (_keep, ctx, chat) = chat_with_history().await;
    let params = json!({"sessionId":chat,"itemId":"m50","before":30,"after":20});
    let (old, old_frames) = call_with(
        &ctx,
        "_mainframe.dev/history_around",
        params.clone(),
        |conn| {
            conn.mark_compressed_replay_opted_in();
        },
    )
    .await;
    assert!(old_frames.is_empty());
    assert!(old["result"].get("batchFrames").is_none());
    let legacy: Vec<Value> = old["result"]["batches"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|batch| {
            use base64::Engine as _;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(batch["data"].as_str().unwrap())
                .unwrap();
            inflate(&bytes)
        })
        .collect();

    let (new, frames) = call_with(&ctx, "_mainframe.dev/history_around", params, |conn| {
        conn.mark_binary_history_frames_opted_in();
    })
    .await;
    let result = &new["result"];
    assert!(result.get("batches").is_none() && result.get("updates").is_none());
    assert_eq!(result["batchFrames"], frames.len());
    assert_eq!(result["targetItemId"], old["result"]["targetItemId"]);
    let binary: Vec<Value> = frames
        .iter()
        .enumerate()
        .flat_map(|(index, raw)| {
            let frame = mainframe_acp::binary_frame::decode_frame(raw).unwrap();
            assert_eq!(
                (frame.id, frame.index, frame.total),
                ("7", index, frames.len())
            );
            inflate(frame.payload)
        })
        .collect();
    assert!(!binary.is_empty());
    assert_eq!(binary, legacy);
}
