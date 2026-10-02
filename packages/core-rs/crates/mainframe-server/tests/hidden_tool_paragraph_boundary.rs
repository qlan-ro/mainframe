//! Production-path regression for todo #383: a hidden-category tool call
//! (Claude's `TodoWrite`, `AskUserQuestion`, ...) sitting between two visible
//! text contributions of one display message must not let the two texts
//! coalesce with no separator once the hidden call is dropped.
//!
//! Builds raw `ChatMessage`s the way the Claude CLI actually emits them —
//! separate assistant-text / assistant-tool_use / user-tool_result /
//! assistant-text turns, exactly like `fn raw_msg` in
//! `mainframe-adapter-claude/src/messages/display_pipeline.rs`'s own tests —
//! and runs them through the real `prepare_messages_for_client` +
//! `encode`/`encode_revision` pipeline (the same two calls
//! `live_vs_cold_reload_golden.rs` exercises), with the adapter's real
//! `ClaudeAdapter::default().get_tool_categories()` rather than a hand-built
//! `ToolCategories`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashMap;

use mainframe_acp::encoder::{EncodedItem, ItemRole, encode, encode_revision};
use mainframe_adapter_api::Adapter;
use mainframe_adapter_claude::adapter::ClaudeAdapter;
use mainframe_adapter_claude::messages::display_pipeline::prepare_messages_for_client;
use mainframe_types::acp::content::ContentBlock;
use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};
use mainframe_types::content::LeafContent;
use mainframe_types::display::StreamingLeafKind;

const CHAT_ID: &str = "chat-383";

fn ts(n: u32) -> String {
    format!("2026-01-01T00:00:{n:02}.000Z")
}

fn text_msg(id: &str, t: ChatMessageType, text: &str, n: u32) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        chat_id: CHAT_ID.to_string(),
        r#type: t,
        content: vec![MessageContent::Leaf(LeafContent::Text {
            text: text.to_string(),
            parent_tool_use_id: None,
        })],
        timestamp: ts(n),
        metadata: None,
    }
}

fn tool_use_msg(id: &str, tool_use_id: &str, name: &str, n: u32) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        chat_id: CHAT_ID.to_string(),
        r#type: ChatMessageType::Assistant,
        content: vec![MessageContent::Node(MessageContentNode::ToolUse {
            timing: None,
            command_execution: None,
            id: tool_use_id.to_string(),
            name: name.to_string(),
            input: HashMap::new(),
            parent_tool_use_id: None,
        })],
        timestamp: ts(n),
        metadata: None,
    }
}

fn tool_result_msg(id: &str, tool_use_id: &str, n: u32) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        chat_id: CHAT_ID.to_string(),
        r#type: ChatMessageType::ToolResult,
        content: vec![MessageContent::Node(MessageContentNode::ToolResult {
            tool_use_id: tool_use_id.to_string(),
            content: "ok".to_string(),
            is_error: false,
            structured_patch: None,
            original_file: None,
            modified_file: None,
            images: Vec::new(),
            parent_tool_use_id: None,
        })],
        timestamp: ts(n),
        metadata: None,
    }
}

/// `assistant text, assistant tool_use(hidden), [user tool_result,]
/// assistant text` — the four (or three) raw turns the CLI actually produces
/// (module doc). `AskUserQuestion` stays hidden only while unanswered
/// (`display_helpers.rs::convert_assistant_content`'s `result_block.is_some()`
/// override promotes an answered one to `ToolCategory::Default`), so its case
/// omits the tool_result turn — `TodoWrite`'s hidden category is name-based
/// and unaffected either way.
fn four_turn_transcript(hidden_tool: &str, attach_result: bool) -> Vec<ChatMessage> {
    let mut messages = vec![
        text_msg("m1", ChatMessageType::Assistant, "first paragraph", 1),
        tool_use_msg("m2", "tu1", hidden_tool, 2),
    ];
    if attach_result {
        messages.push(tool_result_msg("m3", "tu1", 3));
    }
    messages.push(text_msg(
        "m4",
        ChatMessageType::Assistant,
        "second paragraph",
        4,
    ));
    messages
}

fn message_text(item: &EncodedItem) -> String {
    match item {
        EncodedItem::Message { content, .. } => content
            .iter()
            .map(|b| match b {
                ContentBlock::Text { text, .. } => text.clone(),
                ContentBlock::Image { .. } => String::new(),
            })
            .collect(),
        other => panic!("expected a Message item, got {other:?}"),
    }
}

fn run(hidden_tool: &str, attach_result: bool) -> Vec<EncodedItem> {
    let categories = ClaudeAdapter::default()
        .get_tool_categories()
        .expect("ClaudeAdapter always declares tool categories");
    let raw = four_turn_transcript(hidden_tool, attach_result);
    let display = prepare_messages_for_client(&raw, Some(&categories));
    encode(&display)
}

#[test]
fn todo_write_between_two_texts_keeps_a_paragraph_break() {
    let items = run("TodoWrite", true);
    // One message item — the hidden call left no item of its own — carrying
    // both paragraphs, separated by exactly one blank line.
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].id(), "m1");
    assert!(matches!(
        &items[0],
        EncodedItem::Message {
            role: ItemRole::Agent,
            ..
        }
    ));
    assert_eq!(
        message_text(&items[0]),
        "first paragraph\n\nsecond paragraph"
    );
}

#[test]
fn ask_user_question_between_two_texts_keeps_a_paragraph_break() {
    let items = run("AskUserQuestion", false);
    assert_eq!(items.len(), 1);
    assert_eq!(
        message_text(&items[0]),
        "first paragraph\n\nsecond paragraph"
    );
}

/// `text, Read, TodoWrite, Read, text` — the hidden call sits inside an
/// explore run, which already pushes a visible `_tool_group`/tool-call item
/// separating the two texts. Both texts stay unmodified.
#[test]
fn a_hidden_call_inside_an_explore_run_needs_no_extra_break() {
    let categories = ClaudeAdapter::default().get_tool_categories().unwrap();
    let raw = vec![
        text_msg("m1", ChatMessageType::Assistant, "first", 1),
        tool_use_msg("m2", "r1", "Read", 2),
        tool_use_msg("m3", "h1", "TodoWrite", 3),
        tool_use_msg("m4", "r2", "Read", 4),
        tool_result_msg("m5", "r1", 5),
        tool_result_msg("m6", "h1", 6),
        tool_result_msg("m7", "r2", 7),
        text_msg("m8", ChatMessageType::Assistant, "second", 8),
    ];
    let display = prepare_messages_for_client(&raw, Some(&categories));
    let items = encode(&display);

    let texts: Vec<&EncodedItem> = items
        .iter()
        .filter(|i| matches!(i, EncodedItem::Message { .. }))
        .collect();
    assert_eq!(texts.len(), 2, "explore item must split the two texts");
    assert_eq!(message_text(texts[0]), "first");
    assert_eq!(message_text(texts[1]), "second");
}

/// `text, TodoWrite, Read, text` — the hidden call precedes the explore run
/// rather than sitting inside it; the run still separates the texts, so no
/// boundary is needed (and none leaks past the run's visible item).
#[test]
fn a_hidden_call_before_an_explore_run_needs_no_extra_break() {
    let categories = ClaudeAdapter::default().get_tool_categories().unwrap();
    let raw = vec![
        text_msg("m1", ChatMessageType::Assistant, "first", 1),
        tool_use_msg("m2", "h1", "TodoWrite", 2),
        tool_use_msg("m3", "r1", "Read", 3),
        tool_result_msg("m4", "h1", 4),
        tool_result_msg("m5", "r1", 5),
        text_msg("m6", ChatMessageType::Assistant, "second", 6),
    ];
    let display = prepare_messages_for_client(&raw, Some(&categories));
    let items = encode(&display);

    let texts: Vec<&EncodedItem> = items
        .iter()
        .filter(|i| matches!(i, EncodedItem::Message { .. }))
        .collect();
    assert_eq!(texts.len(), 2, "explore item must split the two texts");
    assert_eq!(message_text(texts[0]), "first");
    assert_eq!(message_text(texts[1]), "second");
}

/// Streaming: `[text, TodoWrite]` completed, followed by an overlay tail
/// whose text grows over several revisions (including one that is only
/// `"\n"`). Each revision's text must be a prefix of the next, the final
/// revision with streaming stripped must equal `encode` of the completed
/// transcript, and the final segment must carry `streaming: true`.
#[test]
fn streaming_revisions_of_the_second_paragraph_stay_prefix_monotonic() {
    let categories = ClaudeAdapter::default().get_tool_categories().unwrap();
    let completed = vec![
        text_msg("m1", ChatMessageType::Assistant, "first paragraph", 1),
        tool_use_msg("m2", "tu1", "TodoWrite", 2),
        tool_result_msg("m3", "tu1", 3),
    ];

    let tails = ["\n", "\nsecond", "\nsecond paragraph"];
    let mut previous_text: Option<String> = None;
    let mut final_items: Vec<EncodedItem> = Vec::new();

    for tail in tails {
        let mut raw = completed.clone();
        raw.push(text_msg("m4", ChatMessageType::Assistant, tail, 4));
        let display = prepare_messages_for_client(&raw, Some(&categories));
        let items = encode_revision(&display, Some(StreamingLeafKind::Text));

        assert_eq!(items.len(), 1, "the hidden call still emits no item");
        let text = message_text(&items[0]);
        if let Some(prev) = &previous_text {
            assert!(
                text.starts_with(prev.as_str()),
                "revision {text:?} must extend the previous revision {prev:?}"
            );
        }
        previous_text = Some(text);
        final_items = items;
    }

    // The final revision (streaming stripped) must equal `encode` of the
    // completed transcript, and the open segment must carry `streaming`.
    let mut raw = completed;
    raw.push(text_msg(
        "m4",
        ChatMessageType::Assistant,
        "\nsecond paragraph",
        4,
    ));
    let display = prepare_messages_for_client(&raw, Some(&categories));
    let cold_items = encode(&display);
    assert_eq!(
        message_text(&final_items[0]),
        message_text(&cold_items[0]),
        "the final streaming revision must match a cold encode of the same transcript"
    );
    assert_eq!(
        message_text(&final_items[0]),
        "first paragraph\n\nsecond paragraph"
    );

    match &final_items[0] {
        EncodedItem::Message { meta, .. } => {
            let streaming = meta
                .as_ref()
                .and_then(|m| m.get("_mainframe.dev"))
                .and_then(|m| m.get("streaming"))
                .and_then(|v| v.as_bool());
            assert_eq!(streaming, Some(true));
        }
        other => panic!("expected a Message item, got {other:?}"),
    }
}
