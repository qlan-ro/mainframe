//! Ported from `packages/core/src/messages/display-helpers.ts`.
//!
//! CRATE-SPLIT NOTE (PORTING §2.5 amendment): this file imports the Claude-
//! specific message parsers (`message_parsing`, `parse_ask_user_question`) and the
//! Claude `GroupedMessage`, so — per the "references Claude shapes → adapter-claude"
//! test — it was REASSIGNED from `mainframe-display` to this crate together with
//! `display_pipeline`. The adapter-agnostic grouping primitives it calls
//! (`group_tool_call_parts`, `group_task_children`, `truncate_tool_content`) stay in
//! `mainframe-display`, which this crate depends on.

use super::parse_ask_user_question::{
    KnownQuestion, KnownQuestionOption, parse_ask_user_question_result,
};
use mainframe_display::truncate_tool_content::truncate_tool_content;
use mainframe_types::chat::{MessageContent, MessageContentNode};
use mainframe_types::content::LeafContent;
use mainframe_types::display::{ToolCallResult, ToolCategories, ToolCategory};
use serde_json::Value;
use std::collections::HashMap;

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

pub(super) fn category_str(c: ToolCategory) -> &'static str {
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
        images,
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
        // Never truncated (todo #363) — copied verbatim from the transcript node.
        images: images.clone(),
    })
}

/// Convert a grouped assistant message to `DisplayContent[]`.
pub use super::display_assistant::convert_assistant_content;
pub use super::display_tool_groups::apply_tool_grouping;
pub use super::display_user::convert_user_content;
#[cfg(test)]
#[path = "display_helpers_tests.rs"]
mod tests;
