#![allow(clippy::unwrap_used)]

use mainframe_acp::encoder::{EncodedItem, encode};
use mainframe_adapter_claude::messages::display_pipeline::prepare_messages_for_client;
use mainframe_types::chat::ChatMessage;
use mainframe_types::display::ToolCategories;
use serde_json::{Value, json};
use std::collections::HashSet;

fn message(id: &str, block: Value, phase: &str) -> ChatMessage {
    serde_json::from_value(json!({
        "id":id,"chatId":"integration","type":"assistant","timestamp":"t","content":[block],
        "metadata":{"transcriptPresentation":{"version":1,"provider":"fixture","turnId":"turn",
            "phase":phase,"state":"completed","finalEligible":phase=="final_answer"}}
    }))
    .unwrap()
}

fn source_messages() -> Vec<ChatMessage> {
    vec![
        message("work", json!({"type":"text","text":"🦀work"}), "commentary"),
        message(
            "hidden",
            json!({"type":"tool_use","id":"tool","name":"Hidden","input":{}}),
            "work",
        ),
        message(
            "final",
            json!({"type":"text","text":"e\u{301}final"}),
            "final_answer",
        ),
    ]
}

#[test]
fn hidden_boundary_and_provenance_share_the_transformed_utf16_text() {
    let messages = source_messages();
    let categories = ToolCategories {
        hidden: HashSet::from(["Hidden".into()]),
        explore: HashSet::new(),
        progress: HashSet::new(),
        subagent: HashSet::new(),
    };
    let mut encoded = encode(&prepare_messages_for_client(&messages, Some(&categories)));
    assert_eq!(encoded.len(), 1);
    let EncodedItem::Message {
        id,
        content,
        meta: Some(meta),
        ..
    } = &mut encoded[0]
    else {
        panic!("message")
    };
    assert_eq!(id, "work");
    assert_eq!(
        serde_json::to_value(content).unwrap(),
        json!([{"type":"text","text":"🦀work\n\ne\u{301}final"}])
    );
    let sources = &meta["_mainframe.dev"]["presentationSources"]["sources"];
    assert_eq!(sources.as_array().unwrap().len(), 2);
    assert_eq!(sources[0]["sourceMessageId"], "work");
    assert_eq!(sources[0]["target"]["endUtf16"], 6);
    assert_eq!(sources[1]["sourceMessageId"], "final");
    assert_eq!(sources[1]["target"]["startUtf16"], 6);
    assert_eq!(sources[1]["target"]["endUtf16"], 15);
    meta["_mainframe.dev"]
        .as_object_mut()
        .unwrap()
        .remove("presentationSources");
    let mut legacy = messages;
    for message in &mut legacy {
        message.metadata = None;
    }
    assert_eq!(
        encoded,
        encode(&prepare_messages_for_client(&legacy, Some(&categories)))
    );
}
