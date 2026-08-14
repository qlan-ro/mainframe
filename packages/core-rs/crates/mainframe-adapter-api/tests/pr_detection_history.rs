//! Moved verbatim from `mainframe-server::chat_deps`'s
//! `scan_loaded_history_tests` module (todo #339 task 4) — the cold-load scan now
//! lives in the adapter-neutral crate. Fixture builders are copied (not moved):
//! `mainframe-server` still needs its own copies for the tests left behind.

use std::collections::HashMap;

use mainframe_adapter_api::pr_detection::scan_history_for_prs;
use mainframe_types::adapter::{DetectedPr, DetectedPrSource};
use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};

fn tool_use_msg(id: &str, tool_use_id: &str, name: &str, command: &str) -> ChatMessage {
    let mut input = HashMap::new();
    input.insert(
        "command".to_string(),
        serde_json::Value::String(command.to_string()),
    );
    ChatMessage {
        id: id.to_string(),
        chat_id: "c1".to_string(),
        r#type: ChatMessageType::Assistant,
        content: vec![MessageContent::Node(MessageContentNode::ToolUse {
            id: tool_use_id.to_string(),
            name: name.to_string(),
            input,
            parent_tool_use_id: None,
        })],
        timestamp: "2026-01-01T00:00:01.000Z".to_string(),
        metadata: None,
    }
}

fn tool_result_msg(id: &str, tool_use_id: &str, content: &str) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        chat_id: "c1".to_string(),
        r#type: ChatMessageType::ToolResult,
        content: vec![MessageContent::Node(MessageContentNode::ToolResult {
            tool_use_id: tool_use_id.to_string(),
            content: content.to_string(),
            is_error: false,
            structured_patch: None,
            original_file: None,
            modified_file: None,
            parent_tool_use_id: None,
        })],
        timestamp: "2026-01-01T00:00:02.000Z".to_string(),
        metadata: None,
    }
}

#[test]
fn scan_history_for_prs_marks_source_created_when_tool_use_id_matches_a_pending_gh_pr_create() {
    let history = vec![
        tool_use_msg("m1", "tu1", "Bash", "gh pr create --title x"),
        tool_result_msg("m2", "tu1", "Created https://github.com/acme/repo/pull/7"),
    ];
    let scanned = scan_history_for_prs(&history);
    assert_eq!(
        scanned,
        vec![DetectedPr {
            url: "https://github.com/acme/repo/pull/7".to_string(),
            owner: "acme".to_string(),
            repo: "repo".to_string(),
            number: 7,
            source: DetectedPrSource::Created,
        }]
    );
}

#[test]
fn scan_history_for_prs_marks_source_mentioned_without_a_matching_pending_create() {
    let history = vec![tool_result_msg(
        "m1",
        "tu-unrelated",
        "See https://github.com/acme/repo/pull/9 for context",
    )];
    let scanned = scan_history_for_prs(&history);
    assert_eq!(
        scanned,
        vec![DetectedPr {
            url: "https://github.com/acme/repo/pull/9".to_string(),
            owner: "acme".to_string(),
            repo: "repo".to_string(),
            number: 9,
            source: DetectedPrSource::Mentioned,
        }]
    );
}

#[test]
fn scan_history_for_prs_dedupes_the_same_pr_seen_in_two_tool_results() {
    let history = vec![
        tool_result_msg("m1", "tu1", "https://github.com/acme/repo/pull/3"),
        tool_result_msg("m2", "tu2", "https://github.com/acme/repo/pull/3 again"),
    ];
    assert_eq!(scan_history_for_prs(&history).len(), 1);
}

#[test]
fn scan_history_for_prs_returns_empty_when_no_pr_url_present() {
    let history = vec![tool_result_msg("m1", "tu1", "no PR here")];
    assert!(scan_history_for_prs(&history).is_empty());
}
