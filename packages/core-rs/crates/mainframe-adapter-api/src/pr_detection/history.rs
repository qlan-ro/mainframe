//! Adapter-neutral cold-load rescan: walk a chat's loaded history and classify
//! PR-create commands and their results. Every adapter's `load_scan_records()` /
//! `load_history()` produces the same canonical `ChatMessage` shape this reads.

use std::collections::HashSet;

use mainframe_types::adapter::{DetectedPr, DetectedPrSource};
use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};

use super::command::is_pr_create_command;
use super::parse::extract_pr_from_tool_result;

/// Walk messages in order: assistant `tool_use` blocks identify PR-create
/// commands; subsequent `tool_result` blocks with PR URLs are classified as
/// `created` (matching `toolUseId`) or `mentioned` (everything else).
pub fn scan_history_for_prs(history: &[ChatMessage]) -> Vec<DetectedPr> {
    let mut scanned = Vec::new();
    let mut seen_prs = HashSet::new();
    let mut pending_creates = HashSet::new();
    for msg in history {
        collect_pr_creates(msg, &mut pending_creates);
        if msg.r#type != ChatMessageType::ToolResult {
            continue;
        }
        for block in &msg.content {
            let MessageContent::Node(MessageContentNode::ToolResult {
                content,
                tool_use_id,
                ..
            }) = block
            else {
                continue;
            };
            let Some(pr) = extract_pr_from_tool_result(content) else {
                continue;
            };
            let key = format!("{}/{}/{}", pr.owner, pr.repo, pr.number);
            if !seen_prs.insert(key) {
                continue;
            }
            let source = if pending_creates.remove(tool_use_id) {
                DetectedPrSource::Created
            } else {
                DetectedPrSource::Mentioned
            };
            scanned.push(pr.with_source(source));
        }
    }
    scanned
}

fn collect_pr_creates(msg: &ChatMessage, pending_creates: &mut HashSet<String>) {
    pr_create_ids(msg, |id| {
        pending_creates.insert(id.to_owned());
    });
}

/// Calls `found` with the id of each Bash tool call in an assistant message
/// that creates a PR.
fn pr_create_ids(msg: &ChatMessage, mut found: impl FnMut(&str)) {
    if msg.r#type != ChatMessageType::Assistant {
        return;
    }
    for block in &msg.content {
        let MessageContent::Node(MessageContentNode::ToolUse {
            id, name, input, ..
        }) = block
        else {
            continue;
        };
        if name != "Bash" && name != "BashTool" {
            continue;
        }
        let Some(command) = input.get("command").and_then(|v| v.as_str()) else {
            continue;
        };
        if is_pr_create_command(command) {
            found(id);
        }
    }
}

/// Whether `scan_history_for_prs` can read anything from `msg`: an assistant
/// message with a PR-create Bash call, or a tool result carrying a PR link.
/// A history reduced to the messages this accepts scans to the same links, so
/// a streaming reader can drop the rest as it goes.
pub fn is_scan_relevant(msg: &ChatMessage) -> bool {
    let mut creates = false;
    pr_create_ids(msg, |_| creates = true);
    creates
        || (msg.r#type == ChatMessageType::ToolResult
            && msg.content.iter().any(|block| {
                matches!(
                    block,
                    MessageContent::Node(MessageContentNode::ToolResult { content, .. })
                        if extract_pr_from_tool_result(content).is_some()
                )
            }))
}
