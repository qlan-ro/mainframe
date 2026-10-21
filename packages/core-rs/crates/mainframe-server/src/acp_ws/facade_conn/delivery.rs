use super::FacadeConnection;
use mainframe_types::acp::update::SessionUpdate;

impl FacadeConnection {
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
