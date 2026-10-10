//! Compressed replay batches: a `session/resume` replay for a connection that
//! opted in travels as a few `_mainframe.dev/replay_batch` notifications, each
//! carrying up to [`REPLAY_BATCH_MAX_UPDATES`] `session/update` payloads as a
//! zlib-deflated JSON array in base64, instead of one text frame per update.
//!
//! The replay is the only large transfer on the facade (a long chat's is tens
//! of megabytes of JSON, which deflates five to ten times), and the Rust
//! WebSocket stack the daemon uses has no permessage-deflate, so the
//! compression lives in the payload: plain text frames, nothing to negotiate at
//! the transport, and a client decodes with a stock inflater. Live frames are
//! small and stay as they are; a connection that did not opt in gets the
//! per-update replay, one text frame per `session/update`.

use std::io::Write;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use flate2::Compression;
use flate2::write::ZlibEncoder;
use mainframe_types::acp::extensions::{REPLAY_BATCH_ENCODING, ReplayBatchParams};
use mainframe_types::acp::jsonrpc::JsonRpcNotification;
use mainframe_types::acp::update::SessionUpdate;

/// Updates per batch — bounds the memory one frame holds on either side and
/// lets a client start applying while later batches are still in flight.
pub const REPLAY_BATCH_MAX_UPDATES: usize = 256;

/// The replay `updates`, in order, as `_mainframe.dev/replay_batch`
/// notifications for `session_id`. An empty replay yields no batch at all.
/// A batch that fails to serialize or compress is logged and skipped — the
/// client's `replay_complete` still arrives and its item-count check names
/// the gap.
pub fn replay_batch_notifications(
    session_id: &str,
    updates: &[SessionUpdate],
) -> Vec<JsonRpcNotification> {
    updates
        .chunks(REPLAY_BATCH_MAX_UPDATES)
        .filter_map(|chunk| match encode_batch(chunk) {
            Ok(data) => Some(notification(session_id, chunk.len(), data)),
            Err(err) => {
                tracing::warn!(%err, session_id, count = chunk.len(), "acp facade: dropped a replay batch");
                None
            }
        })
        .collect()
}

/// The payload for one batch: base64 of the zlib-deflated JSON array.
pub(crate) fn encode_batch(updates: &[SessionUpdate]) -> Result<String, String> {
    let json = serde_json::to_vec(updates).map_err(|err| err.to_string())?;
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::fast());
    encoder.write_all(&json).map_err(|err| err.to_string())?;
    let bytes = encoder.finish().map_err(|err| err.to_string())?;
    Ok(STANDARD.encode(bytes))
}

fn notification(session_id: &str, count: usize, data: String) -> JsonRpcNotification {
    JsonRpcNotification {
        jsonrpc: "2.0".into(),
        method: "_mainframe.dev/replay_batch".into(),
        params: Some(serde_json::json!(ReplayBatchParams {
            session_id: session_id.to_string(),
            encoding: REPLAY_BATCH_ENCODING.to_string(),
            count,
            data,
        })),
    }
}

#[cfg(test)]
mod tests;
