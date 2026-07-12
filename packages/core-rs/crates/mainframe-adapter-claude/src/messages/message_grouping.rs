//! Ported from `packages/core/src/messages/message-grouping.ts`.
//!
//! Merges consecutive assistant/tool_use messages into a single turn and
//! attaches tool_result data so assistant-ui can show both invocation and
//! result.
//!
//! CRATE-SPLIT NOTE (PORTING §2.5): this module operates only on the neutral
//! `ChatMessage`/`MessageContent` types — it references no Claude JSONL/event
//! shapes — yet the crate map (§2.7) places it in `adapter-claude::messages`.
//! Its sole consumer is `mainframe-display::display_pipeline`, which lives in a
//! crate `adapter-claude` depends on. Importing `GroupedMessage`/`group_messages`
//! from there would create a dependency cycle. The Phase-B reviewer / the
//! display_pipeline porter must resolve this (most likely by re-homing this file
//! into `mainframe-display`, per the §2.5 "operates on the neutral pipeline"
//! test). Ported here as the scaffold assigned it; flagged for that decision.

use std::collections::{HashMap, HashSet};

use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};

/// A `ChatMessage` plus the tool_result blocks attached during grouping, keyed
/// by `toolUseId`. Mirrors the TS `GroupedMessage` (`_toolResults`).
#[derive(Debug, Clone)]
pub struct GroupedMessage {
    pub base: ChatMessage,
    pub tool_results: HashMap<String, MessageContent>,
}

fn is_assistant_or_tool_use(t: ChatMessageType) -> bool {
    matches!(t, ChatMessageType::Assistant | ChatMessageType::ToolUse)
}

pub fn group_messages(messages: Vec<ChatMessage>) -> Vec<GroupedMessage> {
    let mut result: Vec<GroupedMessage> = Vec::new();

    for msg in messages {
        // Internal turn metadata marker emitted on result events.
        let turn_duration_ms = msg
            .metadata
            .as_ref()
            .and_then(|m| m.get("turnDurationMs"))
            .filter(|v| v.is_number())
            .cloned();
        if msg.r#type == ChatMessageType::System
            && let Some(duration) = turn_duration_ms.clone()
        {
            for prev in result.iter_mut().rev() {
                if is_assistant_or_tool_use(prev.base.r#type) {
                    let mut meta = prev.base.metadata.take().unwrap_or_default();
                    meta.insert("turnDurationMs".to_string(), duration);
                    prev.base.metadata = Some(meta);
                    break;
                }
            }
            continue;
        }

        if msg.r#type == ChatMessageType::ToolResult
            && let Some(prev) = result.last_mut()
            && is_assistant_or_tool_use(prev.base.r#type)
        {
            for block in &msg.content {
                if let MessageContent::Node(MessageContentNode::ToolResult {
                    tool_use_id, ..
                }) = block
                {
                    prev.tool_results.insert(tool_use_id.clone(), block.clone());
                }
            }
            continue;
        }

        // Merge consecutive assistant/tool_use messages into one turn.
        if is_assistant_or_tool_use(msg.r#type)
            && let Some(prev) = result.last_mut()
            && is_assistant_or_tool_use(prev.base.r#type)
        {
            prev.base.content.extend(msg.content);
            continue;
        }

        result.push(GroupedMessage {
            base: msg,
            tool_results: HashMap::new(),
        });
    }

    // Deduplicate tool_use blocks by id across all messages.
    let mut seen_tool_use_ids: HashSet<String> = HashSet::new();
    for msg in result.iter_mut() {
        if !is_assistant_or_tool_use(msg.base.r#type) {
            continue;
        }
        msg.base.content.retain(|block| {
            if let MessageContent::Node(MessageContentNode::ToolUse { id, .. }) = block {
                if seen_tool_use_ids.contains(id) {
                    return false;
                }
                seen_tool_use_ids.insert(id.clone());
            }
            true
        });
    }

    result
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

// PORT STATUS: src/messages/message-grouping.ts (73 lines)
// confidence: high
// todos: 0
// notes: GroupedMessage models the TS `extends ChatMessage { _toolResults? }` as
// a { base, tool_results } struct (the `_`-prefixed field is transient, never
// serialized). CRATE-SPLIT: see the module-doc note — this neutral-pipeline file
// likely belongs in mainframe-display (§2.5) but was scaffolded here; a cycle
// blocks display_pipeline from importing it. No dedicated TS test exists; sanity
// tests cover merge/attach/dedupe/turn-duration.
