//! Merges consecutive assistant/tool_use messages into a single turn and
//! attaches tool_result data so assistant-ui can show both invocation and
//! result.

use std::collections::{HashMap, HashSet};

use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};

/// A `ChatMessage` plus the tool_result blocks attached during grouping, keyed
/// by `toolUseId`.
#[derive(Debug, Clone)]
pub struct GroupedMessage {
    pub base: ChatMessage,
    pub tool_results: HashMap<String, MessageContent>,
}

pub(crate) fn is_assistant_or_tool_use(t: ChatMessageType) -> bool {
    matches!(t, ChatMessageType::Assistant | ChatMessageType::ToolUse)
}

/// A `turnDurationMs` number on a `system` message's metadata, if present.
fn turn_duration(msg: &ChatMessage) -> Option<serde_json::Value> {
    msg.metadata
        .as_ref()
        .and_then(|m| m.get("turnDurationMs"))
        .filter(|v| v.is_number())
        .cloned()
}

/// The per-message grouping decision: shared so `group_messages`
/// and the incremental projector's chunked fold apply one definition instead
/// of two copies that can drift. `prev_mergeable` is whether the group
/// currently being built is an assistant/tool_use run that can still absorb
/// a merge or a tool result.
pub enum GroupingDecision {
    /// A `turnDurationMs` system marker — patches the nearest preceding
    /// assistant/tool_use group at any distance and creates no group.
    DurationMarker(serde_json::Value),
    /// A tool_result whose blocks attach to the current mergeable group.
    AttachResult,
    /// An assistant/tool_use message that merges into the current group.
    Merge,
    /// Starts a new group (covers orphan tool_results, which convert to no
    /// display message, same as every other unmergeable message type).
    NewGroup,
}

pub(crate) fn classify_message(msg: &ChatMessage, prev_mergeable: bool) -> GroupingDecision {
    if msg.r#type == ChatMessageType::System
        && let Some(duration) = turn_duration(msg)
    {
        return GroupingDecision::DurationMarker(duration);
    }
    if msg.r#type == ChatMessageType::ToolResult && prev_mergeable {
        return GroupingDecision::AttachResult;
    }
    if is_assistant_or_tool_use(msg.r#type) && prev_mergeable {
        return GroupingDecision::Merge;
    }
    GroupingDecision::NewGroup
}

pub fn group_messages(messages: Vec<ChatMessage>) -> Vec<GroupedMessage> {
    let mut result: Vec<GroupedMessage> = Vec::new();

    for mut msg in messages {
        super::presentation_grouping::initialize(&mut msg);
        let prev_mergeable = result
            .last()
            .is_some_and(|prev| is_assistant_or_tool_use(prev.base.r#type));

        match classify_message(&msg, prev_mergeable) {
            GroupingDecision::DurationMarker(duration) => {
                patch_nearest_assistant_group(&mut result, duration);
            }
            GroupingDecision::AttachResult => {
                attach_tool_result(result.last_mut(), &msg);
            }
            GroupingDecision::Merge => {
                if let Some(prev) = result.last_mut() {
                    super::presentation_grouping::append(&mut prev.base, &msg);
                    prev.base.content.extend(msg.content);
                }
            }
            GroupingDecision::NewGroup => {
                result.push(GroupedMessage {
                    base: msg,
                    tool_results: HashMap::new(),
                });
            }
        }
    }

    dedupe_tool_use_ids(&mut result);
    result
}

fn patch_nearest_assistant_group(result: &mut [GroupedMessage], duration: serde_json::Value) {
    for prev in result.iter_mut().rev() {
        if is_assistant_or_tool_use(prev.base.r#type) {
            let mut meta = prev.base.metadata.take().unwrap_or_default();
            meta.insert("turnDurationMs".to_string(), duration);
            prev.base.metadata = Some(meta);
            break;
        }
    }
}

fn attach_tool_result(prev: Option<&mut GroupedMessage>, msg: &ChatMessage) {
    let Some(prev) = prev else { return };
    for block in &msg.content {
        if let MessageContent::Node(MessageContentNode::ToolResult { tool_use_id, .. }) = block {
            prev.tool_results.insert(tool_use_id.clone(), block.clone());
        }
    }
}

/// Deduplicate tool_use blocks by id across all messages — a global
/// first-wins post-pass over groups in order. Presentation sources are
/// pruned and re-indexed alongside the dropped blocks, so a
/// source path never points past the deduped content.
fn dedupe_tool_use_ids(result: &mut [GroupedMessage]) {
    let mut seen_tool_use_ids: HashSet<String> = HashSet::new();
    for msg in result.iter_mut() {
        if !is_assistant_or_tool_use(msg.base.r#type) {
            continue;
        }
        let mut index = 0;
        let mut retained = Vec::new();
        msg.base.content.retain(|block| {
            let original_index = index;
            index += 1;
            if let MessageContent::Node(MessageContentNode::ToolUse { id, .. }) = block {
                if seen_tool_use_ids.contains(id) {
                    return false;
                }
                seen_tool_use_ids.insert(id.clone());
            }
            retained.push(original_index);
            true
        });
        super::presentation_grouping::retain(&mut msg.base, &retained);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn msg(id: &str, t: ChatMessageType, content: Vec<MessageContent>) -> ChatMessage {
        ChatMessage {
            id: id.to_string(),
            chat_id: "c".to_string(),
            r#type: t,
            content,
            timestamp: "t".to_string(),
            metadata: None,
        }
    }

    fn tool_use(id: &str) -> MessageContent {
        MessageContent::Node(MessageContentNode::ToolUse {
            timing: None,
            command_execution: None,
            id: id.to_string(),
            name: "Bash".to_string(),
            input: HashMap::new(),
            parent_tool_use_id: None,
        })
    }

    fn tool_result(tool_use_id: &str) -> MessageContent {
        MessageContent::Node(MessageContentNode::ToolResult {
            tool_use_id: tool_use_id.to_string(),
            content: "R".to_string(),
            is_error: false,
            structured_patch: None,
            original_file: None,
            modified_file: None,
            images: Vec::new(),
            parent_tool_use_id: None,
        })
    }

    #[test]
    fn merges_consecutive_assistant_tool_use_turns() {
        let out = group_messages(vec![
            msg("a1", ChatMessageType::Assistant, vec![tool_use("tu_1")]),
            msg("a2", ChatMessageType::ToolUse, vec![tool_use("tu_2")]),
        ]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].base.content.len(), 2);
    }

    #[test]
    fn attaches_tool_results_to_preceding_turn() {
        let out = group_messages(vec![
            msg("a1", ChatMessageType::Assistant, vec![tool_use("tu_1")]),
            msg("r1", ChatMessageType::ToolResult, vec![tool_result("tu_1")]),
        ]);
        assert_eq!(out.len(), 1);
        assert!(out[0].tool_results.contains_key("tu_1"));
    }

    #[test]
    fn dedupes_tool_use_by_id() {
        let out = group_messages(vec![msg(
            "a1",
            ChatMessageType::Assistant,
            vec![tool_use("tu_1"), tool_use("tu_1")],
        )]);
        assert_eq!(out[0].base.content.len(), 1);
    }

    #[test]
    fn attaches_turn_duration_to_last_assistant_turn() {
        let mut sys = msg("s1", ChatMessageType::System, vec![]);
        let mut meta = HashMap::new();
        meta.insert("turnDurationMs".to_string(), json!(1234));
        sys.metadata = Some(meta);
        let out = group_messages(vec![
            msg("a1", ChatMessageType::Assistant, vec![tool_use("tu_1")]),
            sys,
        ]);
        assert_eq!(out.len(), 1);
        assert_eq!(
            out[0].base.metadata.as_ref().unwrap().get("turnDurationMs"),
            Some(&json!(1234))
        );
    }
}
