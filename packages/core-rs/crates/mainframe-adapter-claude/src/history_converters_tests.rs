use super::*;
use serde_json::json;

fn attachment_entry(over: Value, attachment_over: Value) -> Value {
    let mut attachment = json!({
        "type": "queued_command",
        "prompt": [{ "type": "text", "text": "original queued text" }],
        "source_uuid": "u-src",
        "commandMode": "prompt",
        "timestamp": "2026-07-04T00:00:00Z"
    });
    if let Some(o) = attachment_over.as_object() {
        for (k, v) in o {
            attachment[k] = v.clone();
        }
    }
    let mut entry = json!({
        "type": "attachment",
        "uuid": "e1",
        "timestamp": "2026-07-04T00:00:01Z",
        "attachment": attachment
    });
    if let Some(o) = over.as_object() {
        for (k, v) in o {
            entry[k] = v.clone();
        }
    }
    entry
}

#[test]
fn converts_prompt_mode_queued_command_with_original_text() {
    let msg = convert_history_entry(
        &attachment_entry(json!({}), json!({})),
        "c1",
        &mut std::collections::HashSet::new(),
    )
    .unwrap();
    assert_eq!(msg.r#type, ChatMessageType::User);
    assert_eq!(
        msg.content,
        vec![text_block("original queued text".to_string())]
    );
    assert_eq!(msg.id, "e1");
    assert_eq!(msg.timestamp, "2026-07-04T00:00:01Z");
    assert_eq!(
        msg.metadata, None,
        "a queued-command reconstruction with no model/usage attaches no meta, matching live's None"
    );
}

#[test]
fn skips_signature_only_empty_thinking_blocks_in_assistant_history() {
    let entry = json!({
        "type": "assistant",
        "uuid": "a1",
        "timestamp": "2026-07-04T00:00:01Z",
        "message": { "content": [
            { "type": "thinking", "thinking": "   ", "signature": "sig" },
            { "type": "thinking", "thinking": "real plan" },
            { "type": "text", "text": "hi" },
        ]}
    });
    let msg = convert_history_entry(&entry, "c1", &mut std::collections::HashSet::new()).unwrap();
    let thinkings: Vec<&str> = msg
        .content
        .iter()
        .filter_map(|b| match b {
            MessageContent::Leaf(LeafContent::Thinking { thinking, .. }) => Some(thinking.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(thinkings, vec!["real plan"]);
}

#[test]
fn handles_a_plain_string_prompt() {
    let msg = convert_history_entry(
        &attachment_entry(json!({}), json!({ "prompt": "string prompt" })),
        "c1",
        &mut std::collections::HashSet::new(),
    )
    .unwrap();
    assert_eq!(msg.content, vec![text_block("string prompt".to_string())]);
}

#[test]
fn returns_null_for_task_notification_command_mode() {
    assert!(
        convert_history_entry(
            &attachment_entry(json!({}), json!({ "commandMode": "task-notification" })),
            "c1",
            &mut std::collections::HashSet::new()
        )
        .is_none()
    );
}

#[test]
fn returns_null_for_non_queued_command_attachments() {
    assert!(
        convert_history_entry(
            &attachment_entry(json!({}), json!({ "type": "edited_text_file" })),
            "c1",
            &mut std::collections::HashSet::new()
        )
        .is_none()
    );
}

#[test]
fn converts_the_real_captured_fixture_entry() {
    let raw = include_str!("__fixtures__/queued-command-attachment.jsonl");
    let entry = raw
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| serde_json::from_str::<Value>(l).unwrap())
        .find(|e| {
            e.get("type").and_then(Value::as_str) == Some("attachment")
                && e.get("attachment")
                    .and_then(|a| a.get("type"))
                    .and_then(Value::as_str)
                    == Some("queued_command")
        })
        .expect("fixture must contain a queued_command attachment entry");
    let msg = convert_history_entry(&entry, "c1", &mut std::collections::HashSet::new()).unwrap();
    assert_eq!(msg.r#type, ChatMessageType::User);
    let text: String = msg
        .content
        .iter()
        .map(|b| match b {
            MessageContent::Leaf(LeafContent::Text { text, .. }) => text.as_str(),
            _ => "",
        })
        .collect();
    assert!(!text.is_empty());
    assert!(!text.contains("queued_command"));
}
