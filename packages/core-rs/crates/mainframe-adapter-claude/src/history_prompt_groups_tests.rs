use std::collections::HashMap;

use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent};
use mainframe_types::content::LeafContent;
use mainframe_types::transcript_presentation::TURN_GROUP_KEY;

use super::PromptGroups;
use crate::history::load_history_in_dir;

const SESSION: &str = "s-prompt-groups";
const LIMIT: &str = "You've hit your session limit · resets 4:20pm (Europe/Bucharest)";

async fn load_fixture() -> Vec<ChatMessage> {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join(format!("{SESSION}.jsonl")),
        include_str!("__fixtures__/hidden-prompt-groups.jsonl"),
    )
    .unwrap();
    load_history_in_dir(SESSION, &dir.path().to_string_lossy()).await
}

fn turn_group(message: &ChatMessage) -> Option<&str> {
    message.metadata.as_ref()?.get(TURN_GROUP_KEY)?.as_str()
}

fn first_text(message: &ChatMessage) -> Option<&str> {
    message.content.iter().find_map(|block| match block {
        MessageContent::Leaf(LeafContent::Text { text, .. }) => Some(text.as_str()),
        _ => None,
    })
}

/// Turn group of every assistant message, keyed by its first text block.
fn groups_by_text(messages: &[ChatMessage]) -> HashMap<String, Option<String>> {
    messages
        .iter()
        .filter(|m| m.r#type == ChatMessageType::Assistant)
        .filter_map(|m| {
            Some((
                first_text(m)?.to_string(),
                turn_group(m).map(str::to_string),
            ))
        })
        .collect()
}

fn key(prompt: &str) -> Option<String> {
    Some(format!("[\"{SESSION}\",\"{prompt}\"]"))
}

#[tokio::test]
async fn each_hidden_task_notification_reply_gets_its_own_prompt_group() {
    let messages = load_fixture().await;
    let limits: Vec<_> = messages
        .iter()
        .filter(|m| first_text(m) == Some(LIMIT))
        .map(turn_group)
        .collect();
    assert_eq!(
        limits,
        ["P2", "P3", "P4", "P5", "P6"]
            .map(key)
            .iter()
            .map(Option::as_deref)
            .collect::<Vec<_>>()
    );
}

#[tokio::test]
async fn one_prompt_keeps_thinking_text_tool_rows_and_tool_results_together() {
    let messages = load_fixture().await;
    let assistant_groups: Vec<_> = messages
        .iter()
        .filter(|m| m.r#type == ChatMessageType::Assistant)
        .take(4)
        .map(turn_group)
        .collect();
    assert_eq!(assistant_groups, vec![key("P1").as_deref(); 4]);
    let results: Vec<_> = messages
        .iter()
        .filter(|m| m.r#type == ChatMessageType::ToolResult)
        .collect();
    assert_eq!(results.len(), 2);
    assert!(results.iter().all(|m| turn_group(m).is_none()));
}

#[tokio::test]
async fn hidden_companions_resumes_and_api_errors_follow_their_prompt() {
    let groups = groups_by_text(&load_fixture().await);
    assert_eq!(groups["Launching both checks."], key("P1"));
    assert_eq!(groups["Both checks finished."], key("P1"));
    // A resume continuation shares its prompt id with the next hidden prompt.
    assert_eq!(groups["No response requested."], key("P7"));
    assert_eq!(groups["Progress: the build passed."], key("P7"));
    // An isMeta turn companion carries its prompt's id: no new group.
    assert_eq!(groups["Progress: the tests passed."], key("P8"));
    assert_eq!(groups["Invalid API key · Please run /login"], key("P8"));
    assert_eq!(groups["Updating the docs."], key("P8"));
    assert_eq!(groups["Reply without an API id."], key("P9"));
}

#[tokio::test]
async fn unresolvable_ancestry_is_unknown_rather_than_guessed() {
    let groups = groups_by_text(&load_fixture().await);
    for text in [
        "Reply with a missing parent.",
        "Cycle one.",
        "Cycle two.",
        "After compaction.",
    ] {
        assert_eq!(groups[text], None, "{text}");
    }
    assert!(!groups.contains_key("Sidechain reply."));
}

#[test]
fn a_duplicate_uuid_keeps_its_first_record() {
    let mut groups = PromptGroups::default();
    let prompt =
        |id: &str| serde_json::json!({"type":"user","uuid":"u","promptId":id,"sessionId":"s"});
    groups.observe(&prompt("first"), "fallback");
    groups.observe(&prompt("second"), "fallback");
    let reply = serde_json::json!({"type":"assistant","uuid":"a","parentUuid":"u"});
    groups.observe(&reply, "fallback");
    groups.track(0, &reply);
    let mut messages = vec![ChatMessage {
        id: "a".into(),
        chat_id: "c".into(),
        r#type: ChatMessageType::Assistant,
        content: Vec::new(),
        timestamp: "t".into(),
        metadata: None,
    }];
    groups.apply(&mut messages);
    assert_eq!(turn_group(&messages[0]), Some("[\"s\",\"first\"]"));
}
