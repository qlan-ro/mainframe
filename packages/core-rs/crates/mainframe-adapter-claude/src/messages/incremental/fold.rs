//! Chunked folding (todo #376): the same per-message grouping decision and
//! the same `convert_grouped_to_display` the full pipeline uses, applied to
//! one raw slice at a time so a partial update touches only the groups it
//! changed. A full rebuild is just this fold called over `0..raw.len()`.

use std::collections::{HashMap, HashSet};
use std::ops::Range;

use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};
use mainframe_types::display::ToolCategories;
use serde_json::Value;

use crate::messages::display_helpers::is_internal_user_message;
use crate::messages::display_pipeline::convert_grouped_to_display;
use crate::messages::message_grouping::{GroupedMessage, GroupingDecision, classify_message};

/// Re-derive one mergeable group's content fresh from `raw[raw_range]`,
/// applying the global first-wins tool-id dedup against `frozen_tool_ids`.
/// Used both by the main fold (for a freshly created group) and by the
/// nested-patch path (re-converting one settled group in place).
pub(crate) fn fold_merge_group(
    raw: &[ChatMessage],
    raw_range: Range<usize>,
    duration_override: Option<&Value>,
    categories: Option<&ToolCategories>,
    frozen_tool_ids: &HashSet<String>,
) -> (
    Option<mainframe_types::display::DisplayMessage>,
    Vec<String>,
) {
    let mut local_seen: HashSet<String> = HashSet::new();
    let mut content: Vec<MessageContent> = Vec::new();
    let mut tool_results: HashMap<String, MessageContent> = HashMap::new();
    let mut base: Option<ChatMessage> = None;

    for idx in raw_range {
        let msg = &raw[idx];
        if msg.r#type == ChatMessageType::User && is_internal_user_message(&msg.content) {
            continue;
        }
        match classify_message(msg, true) {
            GroupingDecision::AttachResult => collect_tool_results(msg, &mut tool_results),
            GroupingDecision::Merge => {
                if base.is_none() {
                    base = Some(msg.clone());
                }
                extend_deduped(&mut content, &msg.content, frozen_tool_ids, &mut local_seen);
            }
            GroupingDecision::DurationMarker(_) | GroupingDecision::NewGroup => {}
        }
    }

    let Some(mut base) = base else {
        return (None, Vec::new());
    };
    base.content = content;
    base.metadata = merge_duration(base.metadata.take(), duration_override);
    let grouped = GroupedMessage { base, tool_results };
    let display = convert_grouped_to_display(&grouped, categories);
    (display, local_seen.into_iter().collect())
}

fn collect_tool_results(msg: &ChatMessage, tool_results: &mut HashMap<String, MessageContent>) {
    for block in &msg.content {
        if let MessageContent::Node(MessageContentNode::ToolResult { tool_use_id, .. }) = block {
            tool_results.insert(tool_use_id.clone(), block.clone());
        }
    }
}

fn extend_deduped(
    content: &mut Vec<MessageContent>,
    incoming: &[MessageContent],
    frozen: &HashSet<String>,
    local_seen: &mut HashSet<String>,
) {
    for block in incoming {
        if let MessageContent::Node(MessageContentNode::ToolUse { id, .. }) = block {
            if frozen.contains(id) || local_seen.contains(id) {
                continue;
            }
            local_seen.insert(id.clone());
        }
        content.push(block.clone());
    }
}

/// `meta.insert("turnDurationMs", duration)` onto whatever metadata the
/// group's first message already carried (mirrors `group_messages`'s
/// in-place merge, which never replaces unrelated metadata keys).
fn merge_duration(
    existing: Option<HashMap<String, Value>>,
    duration_override: Option<&Value>,
) -> Option<HashMap<String, Value>> {
    match duration_override {
        None => existing,
        Some(duration) => {
            let mut meta = existing.unwrap_or_default();
            meta.insert("turnDurationMs".to_string(), duration.clone());
            Some(meta)
        }
    }
}

/// Convert a single non-mergeable raw message (User/System-non-duration/
/// Error/Permission/orphan ToolResult) into its own group's display, with no
/// merge and no tool-id dedup concerns (these types never carry tool_use
/// blocks in practice).
pub(crate) fn convert_single_message(
    msg: &ChatMessage,
    categories: Option<&ToolCategories>,
) -> Option<mainframe_types::display::DisplayMessage> {
    let grouped = GroupedMessage {
        base: msg.clone(),
        tool_results: HashMap::new(),
    };
    convert_grouped_to_display(&grouped, categories)
}
