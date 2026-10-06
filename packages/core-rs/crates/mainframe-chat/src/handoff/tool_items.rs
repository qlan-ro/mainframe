//! Tool calls → handoff items: commands (with an output tail), file changes,
//! plans, the latest todo list, and subagent results.

use std::collections::{HashMap, HashSet};

use mainframe_types::chat::{MessageContent, MessageContentNode};
use serde_json::Value;

use super::items::{ItemKind, SpanInput};

/// Command output keeps only its tail: the exit status and the error live
/// at the end, and command output is the most common oversized item.
pub const COMMAND_TAIL_BYTES: usize = 2_000;

pub(super) struct ToolOutcome<'a> {
    pub(super) content: &'a str,
    pub(super) is_error: bool,
    pub(super) created: bool,
}

pub(super) struct MapCtx<'a> {
    pub(super) turn: u32,
    pub(super) provider: &'a str,
    pub(super) outcomes: &'a HashMap<&'a str, ToolOutcome<'a>>,
    pub(super) latest_todos: Option<&'a str>,
    pub(super) subagent_tools: &'a HashSet<String>,
}

fn str_input<'a>(input: &'a HashMap<String, Value>, key: &str) -> &'a str {
    input.get(key).and_then(Value::as_str).unwrap_or("")
}

pub(super) fn tool_item(
    id: &str,
    name: &str,
    input: &HashMap<String, Value>,
    ctx: &MapCtx<'_>,
) -> Option<(ItemKind, String)> {
    let outcome = ctx.outcomes.get(id);
    match name {
        "Bash" => Some((
            ItemKind::Command,
            command_text(str_input(input, "command"), outcome),
        )),
        "Edit" | "MultiEdit" => Some((
            ItemKind::FileChange,
            format!("Edited {}", str_input(input, "file_path")),
        )),
        "NotebookEdit" => Some((
            ItemKind::FileChange,
            format!("Edited {}", str_input(input, "notebook_path")),
        )),
        "Write" => {
            let verb = if outcome.is_some_and(|o| !o.created) {
                "Edited"
            } else {
                "Created"
            };
            Some((
                ItemKind::FileChange,
                format!("{verb} {}", str_input(input, "file_path")),
            ))
        }
        "ExitPlanMode" => Some((ItemKind::Plan, str_input(input, "plan").to_string())),
        "TodoWrite" if ctx.latest_todos == Some(id) => Some((ItemKind::Todos, todos_text(input))),
        _ if ctx.subagent_tools.contains(name) => {
            let result = outcome.map_or("", |o| o.content);
            Some((
                ItemKind::SubagentResult,
                format!("Subagent \"{}\": {result}", str_input(input, "description")),
            ))
        }
        _ => None,
    }
}

fn command_text(command: &str, outcome: Option<&ToolOutcome<'_>>) -> String {
    let mut text = format!("$ {command}");
    let Some(outcome) = outcome else {
        return text;
    };
    if outcome.is_error {
        text.push_str("\nexit: failed");
    }
    if !outcome.content.is_empty() {
        text.push('\n');
        text.push_str(&output_tail(outcome.content, COMMAND_TAIL_BYTES));
    }
    text
}

/// The last `max` bytes (on a char boundary), prefixed with how much was cut.
pub fn output_tail(output: &str, max: usize) -> String {
    if output.len() <= max {
        return output.to_string();
    }
    let mut start = output.len() - max;
    while !output.is_char_boundary(start) {
        start += 1;
    }
    format!("…[{start} bytes omitted]{}", &output[start..])
}

fn todos_text(input: &HashMap<String, Value>) -> String {
    let Some(todos) = input.get("todos").and_then(Value::as_array) else {
        return String::new();
    };
    todos
        .iter()
        .map(|t| {
            let mark = match t.get("status").and_then(Value::as_str) {
                Some("completed") => "x",
                Some("in_progress") => "~",
                _ => " ",
            };
            format!(
                "- [{mark}] {}",
                t.get("content").and_then(Value::as_str).unwrap_or("")
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(super) fn tool_outcomes<'a>(spans: &'a [SpanInput<'a>]) -> HashMap<&'a str, ToolOutcome<'a>> {
    let mut map = HashMap::new();
    for msg in spans.iter().flat_map(|s| s.messages) {
        for block in &msg.content {
            if let MessageContent::Node(MessageContentNode::ToolResult {
                tool_use_id,
                content,
                is_error,
                original_file,
                ..
            }) = block
            {
                let created = original_file.is_none();
                map.insert(
                    tool_use_id.as_str(),
                    ToolOutcome {
                        content,
                        is_error: *is_error,
                        created,
                    },
                );
            }
        }
    }
    map
}

/// Only the newest `TodoWrite` in the covered spans is carried.
pub(super) fn latest_todo_write(spans: &[SpanInput<'_>]) -> Option<String> {
    spans
        .iter()
        .filter(|s| s.covered)
        .flat_map(|s| s.messages)
        .flat_map(|m| &m.content)
        .filter_map(|b| match b {
            MessageContent::Node(MessageContentNode::ToolUse {
                id,
                name,
                parent_tool_use_id: None,
                ..
            }) if name == "TodoWrite" => Some(id.clone()),
            _ => None,
        })
        .next_back()
}
