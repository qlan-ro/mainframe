use std::collections::HashMap;

use super::display_helpers::{categorize_tool_call, with_parent_id};
use crate::tool_grouping::{
    PartEntry, TaskGroupEntry, TaskProgressEntry, ToolGroupEntry, ToolGroupItem,
    group_task_children, group_tool_call_parts,
};
use mainframe_types::command_execution::CommandExecutionMetadata;
use mainframe_types::content::LeafContent;
use mainframe_types::display::{
    DisplayContent, DisplayNode, TaskProgressItem, ToolCallResult, ToolCategories, ToolCategory,
};
use serde_json::Value;

pub fn apply_tool_grouping(
    content: impl AsRef<[DisplayContent]>,
    categories: &ToolCategories,
) -> Vec<DisplayContent> {
    let content = content.as_ref();
    let parts: Vec<PartEntry> = content.iter().map(display_content_to_part).collect();

    let grouped = group_tool_call_parts(&parts, categories);
    let grouped = group_task_children(&grouped, categories);

    let converter = Converter {
        sources: tool_call_sources(content),
        categories,
    };
    grouped
        .iter()
        .filter_map(|part| converter.top_level(part))
        .collect()
}

/// The fields of an original top-level tool call that grouping does not
/// carry and the conversion copies back by id.
struct ToolCallSource<'a> {
    category: ToolCategory,
    result: Option<&'a ToolCallResult>,
    command_execution: Option<&'a CommandExecutionMetadata>,
}

/// Index the original top-level tool calls by id. When an id repeats, the
/// category comes from the first call and the result and command metadata
/// from the first call that has them.
fn tool_call_sources(content: &[DisplayContent]) -> HashMap<&str, ToolCallSource<'_>> {
    let mut sources: HashMap<&str, ToolCallSource<'_>> = HashMap::new();
    for block in content {
        if let DisplayContent::Node(DisplayNode::ToolCall {
            id,
            category,
            result,
            command_execution,
            ..
        }) = block
        {
            let source = sources.entry(id.as_str()).or_insert(ToolCallSource {
                category: *category,
                result: None,
                command_execution: None,
            });
            source.result = source.result.or(result.as_ref());
            source.command_execution = source.command_execution.or(command_execution.as_deref());
        }
    }
    sources
}

fn display_content_to_part(c: &DisplayContent) -> PartEntry {
    match c {
        DisplayContent::Node(DisplayNode::ToolCall {
            id,
            name,
            input,
            category,
            parent_tool_use_id,
            ..
        }) => PartEntry::ToolCall {
            tool_call_id: id.clone(),
            tool_name: name.clone(),
            args: input.clone(),
            category: Some(*category),
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
            content: Box::new(other.clone()),
            parent_tool_use_id: with_parent_id(display_content_parent_id(other)),
        },
    }
}

fn display_content_parent_id(c: &DisplayContent) -> &Option<String> {
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
        )
        | DisplayContent::Node(
            DisplayNode::ToolCall {
                parent_tool_use_id, ..
            }
            | DisplayNode::PermissionRequest {
                parent_tool_use_id, ..
            }
            | DisplayNode::Compaction {
                parent_tool_use_id, ..
            },
        ) => parent_tool_use_id,
        _ => &None,
    }
}

struct Converter<'a> {
    sources: HashMap<&'a str, ToolCallSource<'a>>,
    categories: &'a ToolCategories,
}

impl Converter<'_> {
    /// A top-level part; an empty text part renders nothing.
    fn top_level(&self, part: &PartEntry) -> Option<DisplayContent> {
        match part {
            PartEntry::Text { text, .. } if text.is_empty() => None,
            PartEntry::ToolCall {
                tool_call_id,
                tool_name,
                args,
                parent_tool_use_id,
                ..
            } => {
                // A top-level call keeps the category its conversion assigned
                // (an answered AskUserQuestion is `Default`, not `Hidden`).
                let category = self.sources.get(tool_call_id.as_str()).map_or_else(
                    || categorize_tool_call(tool_name, Some(self.categories)),
                    |source| source.category,
                );
                Some(self.tool_call(tool_call_id, tool_name, args, parent_tool_use_id, category))
            }
            other => Some(self.child(other)),
        }
    }

    /// A part nested inside a task group, or any part that is not a
    /// top-level tool call or empty text.
    fn child(&self, part: &PartEntry) -> DisplayContent {
        match part {
            PartEntry::Passthrough { content, .. } => content.as_ref().clone(),
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
                parent_tool_use_id,
                ..
            } => {
                let category = categorize_tool_call(tool_name, Some(self.categories));
                self.tool_call(tool_call_id, tool_name, args, parent_tool_use_id, category)
            }
            PartEntry::ToolGroup(entry) => self.tool_group(entry),
            PartEntry::TaskGroup(entry) => self.task_group(entry),
            PartEntry::TaskProgress(entry) => self.task_progress(entry),
        }
    }

    fn tool_call(
        &self,
        id: &str,
        name: &str,
        input: &HashMap<String, Value>,
        parent_tool_use_id: &Option<String>,
        category: ToolCategory,
    ) -> DisplayContent {
        let source = self.sources.get(id);
        DisplayContent::Node(DisplayNode::ToolCall {
            timing: None,
            command_execution: source
                .and_then(|s| s.command_execution)
                .map(|m| Box::new(m.clone())),
            id: id.to_string(),
            name: name.to_string(),
            input: input.clone(),
            category,
            result: self.result(id),
            parent_tool_use_id: with_parent_id(parent_tool_use_id),
        })
    }

    fn result(&self, id: &str) -> Option<ToolCallResult> {
        self.sources.get(id).and_then(|s| s.result.cloned())
    }

    fn grouped_call(&self, item: &ToolGroupItem) -> DisplayContent {
        let category = categorize_tool_call(&item.tool_name, Some(self.categories));
        self.tool_call(
            &item.tool_call_id,
            &item.tool_name,
            &item.args,
            &item.parent_tool_use_id,
            category,
        )
    }

    fn tool_group(&self, entry: &ToolGroupEntry) -> DisplayContent {
        let calls = entry
            .items
            .iter()
            .map(|item| self.grouped_call(item))
            .collect();
        DisplayContent::Node(DisplayNode::ToolGroup { calls })
    }

    fn task_group(&self, entry: &TaskGroupEntry) -> DisplayContent {
        let calls = entry
            .children
            .iter()
            .map(|child| self.child(child))
            .collect();
        DisplayContent::Node(DisplayNode::TaskGroup {
            timing: None,
            agent_id: entry.tool_call_id.clone(),
            task_args: entry.task_args.clone(),
            calls,
            result: self.result(&entry.tool_call_id),
        })
    }

    fn task_progress(&self, entry: &TaskProgressEntry) -> DisplayContent {
        let items = entry
            .items
            .iter()
            .map(|item| TaskProgressItem {
                timing: None,
                id: item.tool_call_id.clone(),
                name: item.tool_name.clone(),
                input: item.args.clone(),
                category: ToolCategory::Progress,
                result: self.result(&item.tool_call_id),
            })
            .collect();
        DisplayContent::Node(DisplayNode::TaskProgress { items })
    }
}
