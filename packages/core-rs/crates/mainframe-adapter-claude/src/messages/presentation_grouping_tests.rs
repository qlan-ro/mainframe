use super::display_pipeline::prepare_messages_for_client;
use mainframe_types::chat::ChatMessage;
use serde_json::{Value, json};

fn raw(id: &str, text: &str, phase: &str) -> ChatMessage {
    serde_json::from_value(json!({"id":id,"chatId":"c","type":"assistant","timestamp":"t",
        "content":[{"type":"text","text":text}],"metadata":{"model":"preserved-model","transcriptPresentation":{
            "version":1,"provider":"codex","turnId":"thread/turn","state":"running","phase":phase,"finalEligible":phase=="final_answer"
        }}})).unwrap()
}

#[test]
fn mixed_sources_preserve_one_legacy_container_and_transformed_text() {
    let raw = vec![
        raw("a", "Working 🦀\n\n", "commentary"),
        raw("b", "Answer e\u{301}", "final_answer"),
    ];
    let actual = prepare_messages_for_client(&raw, None);
    let mut legacy_raw = raw.clone();
    for message in &mut legacy_raw {
        strip_presentation(&mut message.metadata);
    }
    let legacy = prepare_messages_for_client(&legacy_raw, None);
    let mut stripped = actual.clone();
    for message in &mut stripped {
        strip_presentation(&mut message.metadata);
    }
    assert_eq!(stripped, legacy);
    assert_eq!(actual.len(), 1);
    assert_eq!(actual[0].id, "a");
    let sources = &actual[0].metadata.as_ref().unwrap()["presentationSources"]["sources"];
    assert_eq!(sources[0]["sourceMessageId"], "a");
    assert_eq!(sources[1]["sourceMessageId"], "b");
    assert_eq!(sources[0]["path"], json!([0]));
    assert_eq!(sources[1]["path"], json!([1]));
    assert_ne!(sources[0]["presentation"]["phase"], Value::Null);
}

fn with_block(id: &str, block: Value) -> ChatMessage {
    let mut message = raw(id, "", "work");
    if let Some(parent) = block.get("parentToolUseId") {
        message
            .metadata
            .as_mut()
            .unwrap()
            .get_mut("transcriptPresentation")
            .unwrap()["parentToolUseId"] = parent.clone();
    }
    message.content = serde_json::from_value(json!([block])).unwrap();
    message
}

#[test]
fn source_paths_follow_stripping_tool_groups_and_nested_parent_ownership() {
    use mainframe_types::display::ToolCategories;
    use std::collections::HashSet;
    let messages = nested_messages();
    let categories = ToolCategories {
        explore: HashSet::from(["Read".into()]),
        subagent: HashSet::from(["Task".into()]),
        hidden: HashSet::new(),
        progress: HashSet::new(),
    };
    let actual = prepare_messages_for_client(&messages, Some(&categories));
    let mut legacy = messages.clone();
    for message in &mut legacy {
        strip_presentation(&mut message.metadata);
    }
    let mut stripped = actual.clone();
    for message in &mut stripped {
        strip_presentation(&mut message.metadata);
    }
    assert_eq!(
        stripped,
        prepare_messages_for_client(&legacy, Some(&categories))
    );
    let sources = actual[0].metadata.as_ref().unwrap()["presentationSources"]["sources"]
        .as_array()
        .unwrap();
    assert_eq!(
        sources
            .iter()
            .map(|s| s["sourceMessageId"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["work", "read", "task", "child", "answer"]
    );
    assert_eq!(sources[3]["path"], json!([2, 0]));
    assert_eq!(
        serde_json::to_value(&actual[0].content[0]).unwrap()["text"],
        "🦀"
    );
}

#[test]
fn duplicate_tools_and_stripped_empty_blocks_keep_source_ordinals_exact() {
    let mut message = raw("blocks", "", "commentary");
    message.content = serde_json::from_value(json!([
        {"type":"thinking","thinking":" "},
        {"type":"tool_use","id":"read","name":"Read","input":{}},
        {"type":"tool_use","id":"read","name":"Read","input":{}},
        {"type":"text","text":"Final 🦀"}
    ]))
    .unwrap();
    let actual = prepare_messages_for_client(&[message], None);
    let sources = actual[0].metadata.as_ref().unwrap()["presentationSources"]["sources"]
        .as_array()
        .unwrap();
    assert_eq!(sources.len(), 2);
    assert_eq!(sources[0]["sourceBlockIndex"], 1);
    assert_eq!(sources[1]["sourceBlockIndex"], 3);
    assert_eq!(sources[0]["path"], json!([0]));
    assert_eq!(sources[1]["path"], json!([1]));
}

fn nested_messages() -> Vec<ChatMessage> {
    vec![
        raw(
            "work",
            "<mainframe-command-response id=\"x\">🦀\n\n</mainframe-command-response>",
            "commentary",
        ),
        with_block(
            "read",
            json!({"type":"tool_use","id":"read","name":"Read","input":{}}),
        ),
        with_block(
            "task",
            json!({"type":"tool_use","id":"task","name":"Task","input":{}}),
        ),
        with_block(
            "child",
            json!({"type":"text","text":"child e\u{301}","parentToolUseId":"task"}),
        ),
        raw("answer", "Final 🦀", "final_answer"),
    ]
}

#[test]
fn legacy_child_append_does_not_inherit_its_parent_turn_presentation() {
    let mut message = raw("parent", "Parent", "final_answer");
    message.content.push(
        serde_json::from_value(json!({"type":"text","text":"Child", "parentToolUseId":"task"}))
            .unwrap(),
    );
    let output = prepare_messages_for_client(&[message], None);
    assert_eq!(output[0].content.len(), 2);
    let sources = output[0].metadata.as_ref().unwrap()["presentationSources"]["sources"]
        .as_array()
        .unwrap();
    assert_eq!(sources.len(), 1);
    assert_eq!(sources[0]["path"], json!([0]));
}

fn strip_presentation(metadata: &mut Option<std::collections::HashMap<String, Value>>) {
    if let Some(meta) = metadata {
        meta.retain(|key, _| {
            key != "transcriptPresentation"
                && key != "presentationSources"
                && key != "presentationStreaming"
        });
    }
}
