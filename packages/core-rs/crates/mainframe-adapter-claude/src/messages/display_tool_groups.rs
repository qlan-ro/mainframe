use super::command_metadata::source_command_metadata;
use super::display_helpers::{categorize_tool_call, category_str, with_parent_id};
use mainframe_display::{PartEntry, group_task_children, group_tool_call_parts};
use mainframe_types::content::LeafContent;
use mainframe_types::display::{
    DisplayContent, DisplayNode, TaskProgressItem, ToolCallResult, ToolCategories, ToolCategory,
};
use serde_json::Value;

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
            ..
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
        other => PartEntry::Passthrough {
            content: other.clone(),
            parent_tool_use_id: with_parent_id(&display_content_parent_id(other)),
        },
    }
}

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

fn part_result_to_tool_call_result(result: &Option<Value>) -> Option<ToolCallResult> {
    result
        .as_ref()
        .filter(|v| !v.is_null())
        .and_then(|v| serde_json::from_value(v.clone()).ok())
}

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
                result.push(tool_group(entry, original_content, categories))
            }
            PartEntry::TaskGroup(entry) => {
                result.push(task_group(entry, original_content, categories))
            }
            PartEntry::TaskProgress(entry) => {
                result.push(task_progress(entry, original_content, categories))
            }
            PartEntry::ToolCall { .. } => {
                result.push(regular_tool(part, original_content, categories))
            }
        }
    }

    result
}

fn tool_group(
    entry: &mainframe_display::tool_grouping::ToolGroupEntry,
    original_content: &[DisplayContent],
    categories: &ToolCategories,
) -> DisplayContent {
    let calls: Vec<DisplayContent> = entry
        .items
        .iter()
        .map(|item| {
            DisplayContent::Node(DisplayNode::ToolCall {
                timing: None,
                command_execution: source_command_metadata(original_content, &item.tool_call_id),
                id: item.tool_call_id.clone(),
                name: item.tool_name.clone(),
                input: item.args.clone(),
                category: categorize_tool_call(&item.tool_name, Some(categories)),
                result: part_result_to_tool_call_result(&item.result),
                parent_tool_use_id: with_parent_id(&item.parent_tool_use_id),
            })
        })
        .collect();
    DisplayContent::Node(DisplayNode::ToolGroup { calls })
}

fn task_group(
    entry: &mainframe_display::tool_grouping::TaskGroupEntry,
    original_content: &[DisplayContent],
    categories: &ToolCategories,
) -> DisplayContent {
    let calls: Vec<DisplayContent> = entry
        .children
        .iter()
        .map(|child| convert_task_child(child, original_content, categories))
        .collect();
    DisplayContent::Node(DisplayNode::TaskGroup {
        timing: None,
        agent_id: entry.tool_call_id.clone(),
        task_args: entry.task_args.clone(),
        calls,
        result: part_result_to_tool_call_result(&entry.result),
    })
}

fn task_progress(
    entry: &mainframe_display::tool_grouping::TaskProgressEntry,
    _original_content: &[DisplayContent],
    _categories: &ToolCategories,
) -> DisplayContent {
    let items: Vec<TaskProgressItem> = entry
        .items
        .iter()
        .map(|item| TaskProgressItem {
            timing: None,
            id: item.tool_call_id.clone(),
            name: item.tool_name.clone(),
            input: item.args.clone(),
            category: ToolCategory::Progress,
            result: part_result_to_tool_call_result(&item.result),
        })
        .collect();
    DisplayContent::Node(DisplayNode::TaskProgress { items })
}

fn regular_tool(
    part: &PartEntry,
    original_content: &[DisplayContent],
    categories: &ToolCategories,
) -> DisplayContent {
    let PartEntry::ToolCall {
        tool_call_id,
        tool_name,
        args,
        parent_tool_use_id,
        ..
    } = part
    else {
        return empty_text();
    };

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
    DisplayContent::Node(DisplayNode::ToolCall {
        timing: None,
        command_execution: source_command_metadata(original_content, tool_call_id),
        id: tool_call_id.clone(),
        name: tool_name.clone(),
        input: args.clone(),
        category,
        result: orig_result,
        parent_tool_use_id: with_parent_id(parent_tool_use_id),
    })
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
            timing: None,
            command_execution: source_command_metadata(original_content, tool_call_id),
            id: tool_call_id.clone(),
            name: tool_name.clone(),
            input: args.clone(),
            category: categorize_tool_call(tool_name, Some(categories)),
            result: part_result_to_tool_call_result(result),
            parent_tool_use_id: with_parent_id(parent_tool_use_id),
        }),
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
