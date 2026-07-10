//! Ported from `packages/core/src/messages/display-helpers.ts`.
//!
//! CRATE-SPLIT NOTE (PORTING §2.5 amendment): this file imports the Claude-
//! specific message parsers (`message_parsing`, `parse_ask_user_question`) and the
//! Claude `GroupedMessage`, so — per the "references Claude shapes → adapter-claude"
//! test — it was REASSIGNED from `mainframe-display` to this crate together with
//! `display_pipeline`. The adapter-agnostic grouping primitives it calls
//! (`group_tool_call_parts`, `group_task_children`, `truncate_tool_content`) stay in
//! `mainframe-display`, which this crate depends on.

use std::collections::{HashMap, HashSet};

use mainframe_display::truncate_tool_content::truncate_tool_content;
use mainframe_display::{PartEntry, group_task_children, group_tool_call_parts};
use mainframe_types::chat::{MessageContent, MessageContentNode};
use mainframe_types::content::LeafContent;
use mainframe_types::display::{
    DisplayContent, DisplayNode, TaskProgressItem, ToolCallResult, ToolCategories, ToolCategory,
};
use serde_json::{Value, json};

use super::message_grouping::GroupedMessage;
use super::message_parsing::{
    parse_attached_file_path_tags, parse_command_message, strip_mainframe_command_tags,
};
use super::parse_ask_user_question::{
    KnownQuestion, KnownQuestionOption, parse_ask_user_question_result,
};

/// `/<mainframe-command[\s>]/` — an internal user message marker.
const INTERNAL_USER_TAG: &str = "<mainframe-command";

/// Returns `Some(id)` when `id` is a non-empty string, `None` otherwise (the TS
/// `withParentId` truthy check: `undefined` and `""` both collapse to nothing).
pub fn with_parent_id(id: &Option<String>) -> Option<String> {
    id.as_ref().filter(|s| !s.is_empty()).cloned()
}

/// True if a user message is internal (mainframe commands or skill invocations).
pub fn is_internal_user_message(content: &[MessageContent]) -> bool {
    content.iter().any(|block| match block {
        MessageContent::Leaf(LeafContent::Text { text, .. }) => matches_internal_user(text),
        _ => false,
    })
}

/// Hand-rolled `/<mainframe-command[\s>]/` (no regex crate): the tag followed by
/// whitespace or `>` (so `<mainframe-command-response` does NOT match).
fn matches_internal_user(text: &str) -> bool {
    let mut from = 0;
    while let Some(pos) = text[from..].find(INTERNAL_USER_TAG) {
        let after = from + pos + INTERNAL_USER_TAG.len();
        match text[after..].chars().next() {
            Some(c) if c.is_whitespace() || c == '>' => return true,
            _ => from = from + pos + 1,
        }
    }
    false
}

/// Categorize a tool by name, returning its display category.
pub fn categorize_tool_call(name: &str, categories: Option<&ToolCategories>) -> ToolCategory {
    let Some(c) = categories else {
        return ToolCategory::Default;
    };
    if c.explore.contains(name) {
        ToolCategory::Explore
    } else if c.hidden.contains(name) {
        ToolCategory::Hidden
    } else if c.progress.contains(name) {
        ToolCategory::Progress
    } else if c.subagent.contains(name) {
        ToolCategory::Subagent
    } else {
        ToolCategory::Default
    }
}

fn category_str(c: ToolCategory) -> &'static str {
    match c {
        ToolCategory::Default => "default",
        ToolCategory::Explore => "explore",
        ToolCategory::Hidden => "hidden",
        ToolCategory::Progress => "progress",
        ToolCategory::Subagent => "subagent",
    }
}

fn extract_known_questions(
    tool_input: Option<&HashMap<String, Value>>,
) -> Option<Vec<KnownQuestion>> {
    let q = tool_input?.get("questions")?;
    let arr = q.as_array()?;
    Some(
        arr.iter()
            .filter_map(|item| {
                let question = item.get("question")?.as_str()?.to_string();
                let multi_select = item.get("multiSelect").and_then(Value::as_bool);
                let options = item.get("options").and_then(Value::as_array).map(|opts| {
                    opts.iter()
                        .map(|o| KnownQuestionOption {
                            label: o
                                .get("label")
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                                .to_string(),
                        })
                        .collect()
                });
                Some(KnownQuestion {
                    question,
                    multi_select,
                    options,
                })
            })
            .collect(),
    )
}

/// Build a `ToolCallResult` from a tool_result content block. Returns `None` if
/// `block` is not a tool_result node (the TS type narrows to a tool_result).
pub fn to_tool_call_result(
    block: &MessageContent,
    tool_name: Option<&str>,
    tool_input: Option<&HashMap<String, Value>>,
) -> Option<ToolCallResult> {
    let MessageContent::Node(MessageContentNode::ToolResult {
        content,
        is_error,
        structured_patch,
        original_file,
        modified_file,
        ..
    }) = block
    else {
        return None;
    };
    let t = truncate_tool_content(content);
    Some(ToolCallResult {
        content: t.content,
        is_error: *is_error,
        // `block.structuredPatch && {…}` — present when Some (an empty array is truthy).
        structured_patch: structured_patch.clone(),
        // `block.originalFile && {…}` — an empty string is falsy → omitted.
        original_file: original_file.clone().filter(|s| !s.is_empty()),
        modified_file: modified_file.clone().filter(|s| !s.is_empty()),
        truncated: if t.truncated { Some(true) } else { None },
        full_bytes: if t.truncated { t.full_bytes } else { None },
        ask_user_question: if tool_name == Some("AskUserQuestion") {
            Some(parse_ask_user_question_result(
                content,
                extract_known_questions(tool_input).as_deref(),
            ))
        } else {
            None
        },
    })
}

/// Convert a grouped assistant message to `DisplayContent[]`.
pub fn convert_assistant_content(
    grouped: &GroupedMessage,
    categories: Option<&ToolCategories>,
) -> Vec<DisplayContent> {
    let mut seen_tool_ids: HashSet<String> = HashSet::new();
    let mut content: Vec<DisplayContent> = Vec::new();

    for block in &grouped.base.content {
        match block {
            MessageContent::Leaf(LeafContent::Text {
                text,
                parent_tool_use_id,
            }) => {
                let stripped = strip_mainframe_command_tags(text);
                if !stripped.is_empty() {
                    content.push(DisplayContent::Leaf(LeafContent::Text {
                        text: stripped,
                        parent_tool_use_id: with_parent_id(parent_tool_use_id),
                    }));
                }
            }
            MessageContent::Leaf(LeafContent::Thinking {
                thinking,
                parent_tool_use_id,
            }) => {
                content.push(DisplayContent::Leaf(LeafContent::Thinking {
                    thinking: thinking.clone(),
                    parent_tool_use_id: with_parent_id(parent_tool_use_id),
                }));
            }
            MessageContent::Leaf(LeafContent::Image {
                media_type,
                data,
                parent_tool_use_id,
            }) => {
                content.push(DisplayContent::Leaf(LeafContent::Image {
                    media_type: media_type.clone(),
                    data: data.clone(),
                    parent_tool_use_id: with_parent_id(parent_tool_use_id),
                }));
            }
            MessageContent::Node(MessageContentNode::ToolUse {
                id,
                name,
                input,
                parent_tool_use_id,
            }) => {
                if seen_tool_ids.contains(id) {
                    continue;
                }
                seen_tool_ids.insert(id.clone());

                let result_block = grouped.tool_results.get(id);
                let base_category = categorize_tool_call(name, categories);
                let category = if name == "AskUserQuestion" && result_block.is_some() {
                    ToolCategory::Default
                } else {
                    base_category
                };
                let result =
                    result_block.and_then(|rb| to_tool_call_result(rb, Some(name), Some(input)));
                content.push(DisplayContent::Node(DisplayNode::ToolCall {
                    id: id.clone(),
                    name: name.clone(),
                    input: input.clone(),
                    category,
                    result,
                    parent_tool_use_id: with_parent_id(parent_tool_use_id),
                }));
            }
            _ => {}
        }
    }

    content
}

/// Convert a user message's content blocks to `DisplayContent[]` + metadata.
pub fn convert_user_content(
    content: &[MessageContent],
) -> (Vec<DisplayContent>, HashMap<String, Value>) {
    let mut metadata: HashMap<String, Value> = HashMap::new();
    let mut display_content: Vec<DisplayContent> = Vec::new();

    for block in content {
        match block {
            MessageContent::Leaf(LeafContent::Text {
                text,
                parent_tool_use_id,
            }) => {
                if text.is_empty() || text.starts_with("[Request interrupted") {
                    continue;
                }

                if let Some(cmd_info) = parse_command_message(text) {
                    // Only synthesize a user bubble when the raw text includes a
                    // <command-message> tag (present exclusively for user-typed slash
                    // commands). Bare <command-name>…</command-name> echoes are internal
                    // CLI metadata → suppressed.
                    if !text.contains("<command-message>") {
                        continue;
                    }

                    metadata.insert(
                        "command".to_string(),
                        json!({ "name": cmd_info.command_name, "userText": cmd_info.user_text }),
                    );
                    metadata.insert("cleanText".to_string(), json!(cmd_info.user_text));
                    let args = cmd_info.user_text.trim();
                    let rendered = if !args.is_empty() {
                        format!("/{} {}", cmd_info.command_name, args)
                    } else {
                        format!("/{}", cmd_info.command_name)
                    };
                    display_content.push(DisplayContent::Leaf(LeafContent::Text {
                        text: rendered,
                        parent_tool_use_id: with_parent_id(parent_tool_use_id),
                    }));
                    continue;
                }

                let parsed = parse_attached_file_path_tags(text);
                if !parsed.files.is_empty() {
                    let files: Vec<Value> = parsed
                        .files
                        .iter()
                        .map(|f| json!({ "name": f.name }))
                        .collect();
                    metadata.insert("attachedFiles".to_string(), Value::Array(files));
                }

                let text_to_store = if !parsed.files.is_empty() {
                    parsed.clean_text
                } else {
                    text.clone()
                };

                if !text_to_store.is_empty() {
                    display_content.push(DisplayContent::Leaf(LeafContent::Text {
                        text: text_to_store,
                        parent_tool_use_id: with_parent_id(parent_tool_use_id),
                    }));
                }
            }
            MessageContent::Leaf(LeafContent::Image {
                media_type,
                data,
                parent_tool_use_id,
            }) => {
                display_content.push(DisplayContent::Leaf(LeafContent::Image {
                    media_type: media_type.clone(),
                    data: data.clone(),
                    parent_tool_use_id: with_parent_id(parent_tool_use_id),
                }));
            }
            _ => {}
        }
    }

    (display_content, metadata)
}

/// Apply tool grouping (explore groups, task groups, progress accumulation).
pub fn apply_tool_grouping(
    content: Vec<DisplayContent>,
    categories: &ToolCategories,
) -> Vec<DisplayContent> {
    let parts: Vec<PartEntry> = content.iter().map(display_content_to_part).collect();

    let grouped = group_tool_call_parts(&parts, categories);
    let grouped = group_task_children(&grouped, categories);

    convert_grouped_parts_to_display(&grouped, &content, categories)
}

fn display_content_to_part(c: &DisplayContent) -> PartEntry {
    match c {
        DisplayContent::Node(DisplayNode::ToolCall {
            id,
            name,
            input,
            category,
            result,
            parent_tool_use_id,
        }) => PartEntry::ToolCall {
            tool_call_id: id.clone(),
            tool_name: name.clone(),
            args: input.clone(),
            result: result
                .as_ref()
                .map(|r| serde_json::to_value(r).unwrap_or(Value::Null)),
            is_error: result.as_ref().map(|r| r.is_error),
            category: Some(category_str(*category).to_string()),
            parent_tool_use_id: with_parent_id(parent_tool_use_id),
        },
        DisplayContent::Leaf(LeafContent::Text {
            text,
            parent_tool_use_id,
        }) => PartEntry::Text {
            text: text.clone(),
            parent_tool_use_id: with_parent_id(parent_tool_use_id),
        },
        // Non-groupable content (thinking, image, …) carried as a first-class
        // passthrough entry so it flows through grouping in-place.
        other => PartEntry::Passthrough {
            content: other.clone(),
            parent_tool_use_id: with_parent_id(&display_content_parent_id(other)),
        },
    }
}

/// The `parentToolUseId` on a DisplayContent, if the variant carries one.
fn display_content_parent_id(c: &DisplayContent) -> Option<String> {
    match c {
        DisplayContent::Leaf(
            LeafContent::Text {
                parent_tool_use_id, ..
            }
            | LeafContent::Thinking {
                parent_tool_use_id, ..
            }
            | LeafContent::Image {
                parent_tool_use_id, ..
            }
            | LeafContent::SkillLoaded {
                parent_tool_use_id, ..
            },
        ) => parent_tool_use_id.clone(),
        DisplayContent::Node(
            DisplayNode::ToolCall {
                parent_tool_use_id, ..
            }
            | DisplayNode::PermissionRequest {
                parent_tool_use_id, ..
            }
            | DisplayNode::Compaction {
                parent_tool_use_id, ..
            },
        ) => parent_tool_use_id.clone(),
        _ => None,
    }
}

/// `item.result != null` → deserialize the carried `Value` back into a `ToolCallResult`.
fn part_result_to_tool_call_result(result: &Option<Value>) -> Option<ToolCallResult> {
    result
        .as_ref()
        .filter(|v| !v.is_null())
        .and_then(|v| serde_json::from_value(v.clone()).ok())
}

/// Convert `PartEntry[]` back to `DisplayContent[]`, handling virtual group entries.
fn convert_grouped_parts_to_display(
    parts: &[PartEntry],
    original_content: &[DisplayContent],
    categories: &ToolCategories,
) -> Vec<DisplayContent> {
    let mut result: Vec<DisplayContent> = Vec::new();

    for part in parts {
        match part {
            PartEntry::Passthrough { content, .. } => {
                result.push(content.clone());
            }
            PartEntry::Text {
                text,
                parent_tool_use_id,
            } => {
                if !text.is_empty() {
                    result.push(DisplayContent::Leaf(LeafContent::Text {
                        text: text.clone(),
                        parent_tool_use_id: with_parent_id(parent_tool_use_id),
                    }));
                }
            }
            PartEntry::ToolGroup(entry) => {
                let calls: Vec<DisplayContent> = entry
                    .items
                    .iter()
                    .map(|item| {
                        DisplayContent::Node(DisplayNode::ToolCall {
                            id: item.tool_call_id.clone(),
                            name: item.tool_name.clone(),
                            input: item.args.clone(),
                            category: categorize_tool_call(&item.tool_name, Some(categories)),
                            result: part_result_to_tool_call_result(&item.result),
                            parent_tool_use_id: with_parent_id(&item.parent_tool_use_id),
                        })
                    })
                    .collect();
                result.push(DisplayContent::Node(DisplayNode::ToolGroup { calls }));
            }
            PartEntry::TaskGroup(entry) => {
                // Use the unique tool_use id (regression #184), not `description`.
                let calls: Vec<DisplayContent> = entry
                    .children
                    .iter()
                    .map(|child| convert_task_child(child, original_content, categories))
                    .collect();
                result.push(DisplayContent::Node(DisplayNode::TaskGroup {
                    agent_id: entry.tool_call_id.clone(),
                    task_args: entry.task_args.clone(),
                    calls,
                    result: part_result_to_tool_call_result(&entry.result),
                }));
            }
            PartEntry::TaskProgress(entry) => {
                let items: Vec<TaskProgressItem> = entry
                    .items
                    .iter()
                    .map(|item| TaskProgressItem {
                        id: item.tool_call_id.clone(),
                        name: item.tool_name.clone(),
                        input: item.args.clone(),
                        category: ToolCategory::Progress,
                        result: part_result_to_tool_call_result(&item.result),
                    })
                    .collect();
                result.push(DisplayContent::Node(DisplayNode::TaskProgress { items }));
            }
            PartEntry::ToolCall {
                tool_call_id,
                tool_name,
                args,
                parent_tool_use_id,
                ..
            } => {
                // Regular tool call — find the original DisplayContent to preserve
                // result and category.
                let orig = original_content.iter().find_map(|c| match c {
                    DisplayContent::Node(DisplayNode::ToolCall {
                        id,
                        category,
                        result,
                        ..
                    }) if id == tool_call_id => Some((*category, result.clone())),
                    _ => None,
                });
                let (category, orig_result) = match orig {
                    Some((category, orig_result)) => (category, orig_result),
                    None => (categorize_tool_call(tool_name, Some(categories)), None),
                };
                result.push(DisplayContent::Node(DisplayNode::ToolCall {
                    id: tool_call_id.clone(),
                    name: tool_name.clone(),
                    input: args.clone(),
                    category,
                    result: orig_result,
                    parent_tool_use_id: with_parent_id(parent_tool_use_id),
                }));
            }
        }
    }

    result
}

fn convert_task_child(
    child: &PartEntry,
    original_content: &[DisplayContent],
    categories: &ToolCategories,
) -> DisplayContent {
    match child {
        PartEntry::Passthrough { content, .. } => content.clone(),
        PartEntry::Text {
            text,
            parent_tool_use_id,
        } => DisplayContent::Leaf(LeafContent::Text {
            text: text.clone(),
            parent_tool_use_id: with_parent_id(parent_tool_use_id),
        }),
        PartEntry::ToolCall {
            tool_call_id,
            tool_name,
            args,
            result,
            parent_tool_use_id,
            ..
        } => DisplayContent::Node(DisplayNode::ToolCall {
            id: tool_call_id.clone(),
            name: tool_name.clone(),
            input: args.clone(),
            category: categorize_tool_call(tool_name, Some(categories)),
            result: part_result_to_tool_call_result(result),
            parent_tool_use_id: with_parent_id(parent_tool_use_id),
        }),
        // Recursively resolve any nested grouped entry.
        nested => {
            let resolved = convert_grouped_parts_to_display(
                std::slice::from_ref(nested),
                original_content,
                categories,
            );
            if resolved.len() == 1 {
                resolved.into_iter().next().unwrap_or_else(empty_text)
            } else {
                empty_text()
            }
        }
    }
}

fn empty_text() -> DisplayContent {
    DisplayContent::Leaf(LeafContent::Text {
        text: String::new(),
        parent_tool_use_id: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pr_detection::extract_pr_from_tool_result;
    use mainframe_display::truncate_tool_content::TRUNCATE_THRESHOLD_BYTES;
    use mainframe_types::chat::{ChatMessage, ChatMessageType};

    fn content_from(v: Value) -> MessageContent {
        serde_json::from_value(v).unwrap()
    }

    fn categories(v: Value) -> ToolCategories {
        serde_json::from_value(v).unwrap()
    }

    // ── convertAssistantContent — AskUserQuestion ──────────────────────────────
    fn grouped_auq(tool_use_id: &str, with_result: bool) -> GroupedMessage {
        let base = ChatMessage {
            id: "g".to_string(),
            chat_id: "c".to_string(),
            r#type: ChatMessageType::Assistant,
            content: vec![content_from(json!({
                "type": "tool_use",
                "id": tool_use_id,
                "name": "AskUserQuestion",
                "input": { "questions": [{ "question": "Which DB?" }] },
            }))],
            timestamp: "t".to_string(),
            metadata: None,
        };
        let mut tool_results = HashMap::new();
        if with_result {
            tool_results.insert(
                tool_use_id.to_string(),
                content_from(json!({
                    "type": "tool_result",
                    "toolUseId": tool_use_id,
                    "content": "User has answered your questions: \"Which DB?\"=\"Postgres\". You can now continue with the user's answers in mind.",
                    "isError": false,
                })),
            );
        }
        GroupedMessage { base, tool_results }
    }

    fn auq_categories() -> ToolCategories {
        categories(json!({
            "explore": [],
            "hidden": ["AskUserQuestion"],
            "progress": [],
            "subagent": [],
        }))
    }

    fn find_tool_call(content: &[DisplayContent]) -> Value {
        content
            .iter()
            .map(|c| serde_json::to_value(c).unwrap())
            .find(|v| v["type"] == "tool_call")
            .expect("a tool_call")
    }

    #[test]
    fn answered_ask_user_question_is_category_default_with_parsed_answers() {
        let cats = auq_categories();
        let out = convert_assistant_content(&grouped_auq("tu1", true), Some(&cats));
        let call = find_tool_call(&out);
        assert_eq!(call["category"], "default");
        assert_eq!(
            call["result"]["askUserQuestion"],
            json!([{ "question": "Which DB?", "answer": ["Postgres"] }])
        );
    }

    #[test]
    fn pending_resultless_ask_user_question_stays_hidden() {
        let cats = auq_categories();
        let out = convert_assistant_content(&grouped_auq("tu2", false), Some(&cats));
        let call = find_tool_call(&out);
        assert_eq!(call["category"], "hidden");
    }

    // ── toToolCallResult truncation ────────────────────────────────────────────
    #[test]
    fn flags_and_shrinks_oversized_content() {
        let big = "A".repeat(TRUNCATE_THRESHOLD_BYTES + 5000);
        let block = content_from(json!({
            "type": "tool_result", "toolUseId": "id1", "content": big, "isError": false,
        }));
        let r = to_tool_call_result(&block, None, None).unwrap();
        assert_eq!(r.truncated, Some(true));
        assert_eq!(r.full_bytes, Some((TRUNCATE_THRESHOLD_BYTES + 5000) as i64));
        assert!(r.content.len() < TRUNCATE_THRESHOLD_BYTES + 5000);
    }

    #[test]
    fn leaves_small_content_and_structured_fields_intact() {
        let block = content_from(json!({
            "type": "tool_result", "toolUseId": "id2", "content": "ok", "isError": false,
            "structuredPatch": [{ "oldStart": 1, "oldLines": 1, "newStart": 1, "newLines": 1, "lines": ["-a", "+b"] }],
        }));
        let r = to_tool_call_result(&block, None, None).unwrap();
        assert_eq!(r.truncated, None);
        assert_eq!(r.content, "ok");
        assert_eq!(r.structured_patch.as_ref().map(Vec::len), Some(1));
    }

    #[test]
    fn ingestion_pr_detection_runs_on_full_content_unaffected_by_display_truncation() {
        let url = "https://github.com/acme/repo/pull/4242";
        let filler = (0..3000)
            .map(|i| format!("noise line {i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let huge = format!("{filler}\n{url}\n{filler}");
        assert!(!truncate_tool_content(&huge).content.contains("4242"));
        let result = extract_pr_from_tool_result(&huge);
        assert_eq!(result.map(|p| p.number), Some(4242));
    }

    // ── applyToolGrouping — task_group agentId uniqueness (regression #184) ─────
    fn regression_184_categories() -> ToolCategories {
        categories(json!({
            "explore": [],
            "hidden": [],
            "progress": [],
            "subagent": ["CollabAgent"],
        }))
    }

    fn task_groups(out: &[DisplayContent]) -> Vec<Value> {
        out.iter()
            .map(|c| serde_json::to_value(c).unwrap())
            .filter(|v| v["type"] == "task_group")
            .collect()
    }

    fn tool_call_ids(calls: &Value) -> Vec<String> {
        calls
            .as_array()
            .unwrap()
            .iter()
            .filter(|c| c["type"] == "tool_call")
            .map(|c| c["id"].as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn uses_the_unique_tool_use_id_as_agent_id_even_when_descriptions_repeat() {
        let cats = regression_184_categories();
        let content: Vec<DisplayContent> = serde_json::from_value(json!([
            { "type": "tool_call", "id": "call-A", "name": "CollabAgent",
              "input": { "prompt": "p1", "description": "default", "subagent_type": "role" }, "category": "subagent" },
            { "type": "tool_call", "id": "child-A", "name": "Bash",
              "input": { "command": "echo a" }, "category": "default", "parentToolUseId": "call-A" },
            { "type": "tool_call", "id": "call-B", "name": "CollabAgent",
              "input": { "prompt": "p2", "description": "default", "subagent_type": "role" }, "category": "subagent" },
            { "type": "tool_call", "id": "child-B", "name": "Bash",
              "input": { "command": "echo b" }, "category": "default", "parentToolUseId": "call-B" },
        ]))
        .unwrap();

        let out = apply_tool_grouping(content, &cats);
        let groups = task_groups(&out);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0]["agentId"], "call-A");
        assert_eq!(groups[1]["agentId"], "call-B");
        assert_ne!(groups[0]["agentId"], groups[1]["agentId"]);
        assert_eq!(tool_call_ids(&groups[0]["calls"]), vec!["child-A"]);
        assert_eq!(tool_call_ids(&groups[1]["calls"]), vec!["child-B"]);
    }

    #[test]
    fn preserves_grouping_for_a_single_subagent() {
        let cats = regression_184_categories();
        let content: Vec<DisplayContent> = serde_json::from_value(json!([
            { "type": "tool_call", "id": "toolu_001", "name": "CollabAgent",
              "input": { "description": "investigate auth bug", "prompt": "..." }, "category": "subagent" },
            { "type": "tool_call", "id": "toolu_002", "name": "Read",
              "input": { "file_path": "/auth.ts" }, "category": "default", "parentToolUseId": "toolu_001" },
            { "type": "tool_call", "id": "toolu_003", "name": "Grep",
              "input": { "pattern": "login" }, "category": "default", "parentToolUseId": "toolu_001" },
        ]))
        .unwrap();

        let out = apply_tool_grouping(content, &cats);
        let groups = task_groups(&out);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0]["agentId"], "toolu_001");
        assert_eq!(groups[0]["taskArgs"]["description"], "investigate auth bug");
        assert_eq!(groups[0]["calls"].as_array().unwrap().len(), 2);
    }
}

// PORT STATUS: src/messages/display-helpers.ts (336 lines)
// confidence: high
// todos: 0
// notes: REASSIGNED from mainframe-display → mainframe-adapter-claude (§2.5 amendment):
// notes: imports Claude-specific message_parsing + parse_ask_user_question + the Claude
// notes: GroupedMessage, so it lands on the adapter side; the neutral grouping
// notes: primitives (group_tool_call_parts/group_task_children/truncate_tool_content)
// notes: stay in mainframe-display. DisplayContent is a strong enum here vs the TS
// notes: object soup: tool_call ToolCallResult ↔ PartEntry's loose `result: Value`
// notes: round-trips via serde (to_value on the way in, from_value on the way out).
// notes: withParentId → with_parent_id (empty string is falsy → None). structuredPatch
// notes: kept when Some (empty array truthy); originalFile/modifiedFile dropped when
// notes: empty (JS falsy). INTERNAL_USER_RE + agent heading strip are hand-rolled (no
// notes: regex crate). Tests ported: display-helpers-askuserquestion (2),
// notes: display-helpers-truncate (3), display-helpers-task-group-id / regression #184 (2).
