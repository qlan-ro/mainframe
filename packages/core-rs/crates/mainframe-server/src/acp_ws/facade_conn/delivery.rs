use super::FacadeConnection;
use mainframe_acp::binary_frame;
use mainframe_acp::rpc;
use mainframe_types::acp::extensions::BatchFrame;
use mainframe_types::acp::jsonrpc::RequestId;
use mainframe_types::acp::update::SessionUpdate;
use tokio::sync::mpsc;

impl FacadeConnection {
    /// The receiving end of the binary frame channel, for the socket loop
    /// that owns this connection. Taken once; later calls get `None`.
    pub(crate) fn take_binary_frames(&self) -> Option<mpsc::UnboundedReceiver<Vec<u8>>> {
        use mainframe_types::sync::LockExt as _;
        self.binary_rx.lock_recover().take()
    }

    /// A successful response; one whose `result` says `batchFrames` also
    /// sends the frames, anything else carries no frames.
    pub(crate) fn send_result(
        &self,
        id: Option<RequestId>,
        result: serde_json::Value,
        frames: Vec<BatchFrame>,
    ) {
        if result.get("batchFrames").is_some() {
            self.send_result_with_frames(id, result, frames);
        } else {
            self.send_json(&rpc::success_response(id, result));
        }
    }

    /// A successful response whose `result` says `batchFrames: N`, followed
    /// by its N binary frames tied to `id`. The frames are queued first and
    /// the socket loop drains the binary queue ahead of any text frame
    /// (`handle_outbound`), so they reach the client before the response,
    /// though other messages may sit between them; the client pairs them by
    /// id and index and tolerates either order. A frame that cannot be framed turns the whole reply
    /// into an error, so the client never waits for a batch that will not come.
    pub(crate) fn send_result_with_frames(
        &self,
        id: Option<RequestId>,
        result: serde_json::Value,
        frames: Vec<BatchFrame>,
    ) {
        let Some(request_id) = id.as_ref().map(binary_frame::id_text) else {
            self.send_json(&rpc::success_response(id, result));
            return;
        };
        let total = frames.len();
        let encoded: Option<Vec<Vec<u8>>> = frames
            .iter()
            .enumerate()
            .map(|(index, frame)| binary_frame::encode_frame(&request_id, index, total, frame))
            .collect();
        let Some(encoded) = encoded else {
            tracing::warn!(
                request_id,
                total,
                "history frames did not fit the frame header"
            );
            self.send_json(&rpc::error_response(
                id,
                rpc::internal_error("history frames could not be encoded"),
            ));
            return;
        };
        for frame in encoded {
            // A send error means the socket loop is gone, as for text frames.
            let _ = self.binary_tx.send(frame);
        }
        self.send_json(&rpc::success_response(id, result));
    }

    pub(crate) fn send_replay(&self, chat_id: &str, mut updates: Vec<SessionUpdate>) {
        if self.is_lazy_tool_images_opted_in() {
            for update in &mut updates {
                mainframe_acp::tool_images::reference_images(chat_id, update);
            }
        }
        if self.is_compressed_replay_opted_in() {
            for note in mainframe_acp::replay_batch_notifications(chat_id, &updates) {
                self.send_json(&note);
            }
        } else {
            for update in updates {
                self.send_update(chat_id, update);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine as _;
    use serde_json::{Value, json};
    use std::io::Read;
    use tokio::sync::mpsc;

    fn image_update() -> SessionUpdate {
        serde_json::from_value(json!({
            "sessionUpdate":"tool_call_update","toolCallId":"tool_1",
            "content":[{"type":"content","content":{
                "type":"image","data":"A".repeat(500_000),"mimeType":"image/png"
            }}]
        }))
        .unwrap()
    }

    fn decode(frame: &str) -> Value {
        let note: Value = serde_json::from_str(frame).unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(note["params"]["data"].as_str().unwrap())
            .unwrap();
        let mut json = String::new();
        flate2::read::ZlibDecoder::new(bytes.as_slice())
            .read_to_string(&mut json)
            .unwrap();
        serde_json::from_str(&json).unwrap()
    }

    #[test]
    fn compressed_replay_omits_pixels_only_for_an_opted_in_connection() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let conn = FacadeConnection::new("claude".into(), tx);
        conn.mark_compressed_replay_opted_in();
        conn.send_replay("chat_1", vec![image_update()]);
        let original = decode(&rx.try_recv().unwrap());
        assert_eq!(
            original[0]["content"][0]["content"]["data"]
                .as_str()
                .unwrap()
                .len(),
            500_000
        );
        conn.mark_lazy_tool_images_opted_in();
        conn.send_replay("chat_1", vec![image_update()]);
        let frame = rx.try_recv().unwrap();
        assert!(frame.len() < 1_000);
        let lazy = decode(&frame);
        assert_eq!(lazy[0]["content"][0]["content"]["data"], "");
        assert!(lazy[0]["content"][0]["content"]["uri"].is_string());
    }

    #[test]
    fn live_updates_use_the_same_image_reference_as_replay() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let conn = FacadeConnection::new("claude".into(), tx);
        conn.mark_lazy_tool_images_opted_in();
        conn.send_update("chat_1", image_update());
        let live: Value = serde_json::from_str(&rx.try_recv().unwrap()).unwrap();
        conn.mark_compressed_replay_opted_in();
        conn.send_replay("chat_1", vec![image_update()]);
        let replay = decode(&rx.try_recv().unwrap());
        assert_eq!(live["params"]["update"], replay[0]);
    }
}
