use std::collections::HashMap;

use mainframe_types::chat::{ChatMessage, MessageContent, MessageContentNode};
use mainframe_types::display::{DisplayContent, DisplayMessage, DisplayNode};
use mainframe_types::tool_call_timing::ToolCallTiming;

pub fn apply_tool_call_timing(raw: &[ChatMessage], display: &mut [DisplayMessage]) {
    let mut timings = HashMap::new();
    for block in raw.iter().flat_map(|message| &message.content) {
        if let MessageContent::Node(MessageContentNode::ToolUse {
            id,
            timing: Some(timing),
            ..
        }) = block
            && timing.is_valid()
        {
            timings.entry(id.as_str()).or_insert(*timing);
        }
    }
    for message in display {
        apply_to_blocks(&mut message.content, &timings);
    }
}

/// Single-id, single-container variant for the incremental projector: a
/// `timing(id)` journal entry patches only the one node that owns `id`,
/// leaving every other node's cached timing in the container untouched (unlike
/// [`apply_tool_call_timing`], which recomputes every node from a full map).
pub fn apply_tool_call_timing_to_container(
    container: &mut DisplayMessage,
    id: &str,
    timing: Option<ToolCallTiming>,
) {
    patch_blocks(&mut container.content, id, timing);
}

fn patch_blocks(blocks: &mut [DisplayContent], id: &str, timing: Option<ToolCallTiming>) {
    for block in blocks {
        match block {
            DisplayContent::Node(DisplayNode::ToolCall {
                id: block_id,
                timing: slot,
                ..
            }) if block_id == id => {
                *slot = timing;
            }
            DisplayContent::Node(DisplayNode::TaskGroup {
                agent_id,
                timing: slot,
                calls,
                ..
            }) => {
                if agent_id == id {
                    *slot = timing;
                }
                patch_blocks(calls, id, timing);
            }
            DisplayContent::Node(DisplayNode::ToolGroup { calls }) => {
                patch_blocks(calls, id, timing)
            }
            DisplayContent::Node(DisplayNode::TaskProgress { items }) => {
                for item in items {
                    if item.id == id {
                        item.timing = timing;
                    }
                }
            }
            _ => {}
        }
    }
}

fn apply_to_blocks(blocks: &mut [DisplayContent], timings: &HashMap<&str, ToolCallTiming>) {
    for block in blocks {
        match block {
            DisplayContent::Node(DisplayNode::ToolCall { id, timing, .. }) => {
                *timing = timings.get(id.as_str()).copied();
            }
            DisplayContent::Node(DisplayNode::TaskGroup {
                agent_id,
                timing,
                calls,
                ..
            }) => {
                *timing = timings.get(agent_id.as_str()).copied();
                apply_to_blocks(calls, timings);
            }
            DisplayContent::Node(DisplayNode::ToolGroup { calls }) => {
                apply_to_blocks(calls, timings)
            }
            DisplayContent::Node(DisplayNode::TaskProgress { items }) => {
                for item in items {
                    item.timing = timings.get(item.id.as_str()).copied();
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests;
