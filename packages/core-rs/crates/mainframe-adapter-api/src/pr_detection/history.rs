//! Adapter-neutral cold-load rescan: walk a chat's loaded history and classify
//! PR-create commands and their results. Moved verbatim from
//! `mainframe-server::chat_deps::scan_history_for_prs` (todo #339 task 4) — every
//! adapter's `load_scan_records()` / `load_history()` produces the same canonical
//! `ChatMessage` shape this reads.

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
        if msg.r#type == ChatMessageType::Assistant {
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
                    pending_creates.insert(id.clone());
                }
            }
        }
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
