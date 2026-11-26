use super::*;
use serde_json::json;

#[test]
fn only_queued_attachments_inside_a_turn_are_steered() {
    let mut history = HistoryLoad::default();
    let attachment = |id| {
        json!({
            "type": "attachment", "uuid": id,
            "attachment": {"type": "queued_command", "commandMode": "prompt", "prompt": "next"}
        })
    };
    for entry in [
        json!({"type": "user", "uuid": "start", "message": {"content": "begin"}}),
        attachment("steer"),
        json!({"type": "result", "subtype": "success"}),
        attachment("native-queue"),
    ] {
        history.entry(&entry, "chat", false);
    }
    let steered: Vec<_> = history
        .messages
        .iter()
        .filter(|m| m.metadata.as_ref().and_then(|meta| meta.get("steered")) == Some(&json!(true)))
        .map(|m| m.id.as_str())
        .collect();
    assert_eq!(steered, ["steer"]);
}
