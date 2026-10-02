use super::display_helpers::{categorize_tool_call, to_tool_call_result, with_parent_id};
use super::message_grouping::GroupedMessage;
use super::message_parsing::strip_mainframe_command_tags;
use mainframe_types::chat::{MessageContent, MessageContentNode};
use mainframe_types::content::LeafContent;
use mainframe_types::display::{DisplayContent, DisplayNode, ToolCategories, ToolCategory};
use mainframe_types::transcript_presentation::DisplayPresentationSource;
use std::collections::{HashMap, HashSet};

pub(super) fn convert_assistant_with_sources(
    grouped: &GroupedMessage,
    categories: Option<&ToolCategories>,
) -> (Vec<DisplayContent>, Vec<DisplayPresentationSource>) {
    let mut seen = HashSet::new();
    let results = grouped
        .base
        .content
        .iter()
        .filter_map(|block| match block {
            MessageContent::Node(MessageContentNode::ToolResult { tool_use_id, .. }) => {
                Some((tool_use_id.as_str(), block))
            }
            _ => None,
        })
        .collect::<HashMap<_, _>>();
    let raw_sources = super::presentation_grouping::sources(grouped.base.metadata.as_ref());
    let mut source_map: HashMap<Vec<usize>, Vec<DisplayPresentationSource>> = HashMap::new();
    for source in raw_sources.into_iter().flat_map(|s| s.sources) {
        source_map
            .entry(source.path.clone())
            .or_default()
            .push(source);
    }
    let mut content = Vec::new();
    let mut sources = Vec::new();
    for (index, block) in grouped.base.content.iter().enumerate() {
        let display = match block {
            MessageContent::Leaf(leaf) => convert_leaf(leaf),
            MessageContent::Node(MessageContentNode::ToolUse { id, .. }) if seen.insert(id) => {
                let result = grouped
                    .tool_results
                    .get(id)
                    .or_else(|| results.get(id.as_str()).copied());
                convert_tool(block, result, categories)
            }
            _ => None,
        };
        if let Some(display) = display {
            for mut entry in source_map.remove(&vec![index]).unwrap_or_default() {
                entry.path = vec![content.len()];
                sources.push(entry);
            }
            content.push(display);
        }
    }
    (content, sources)
}

fn convert_leaf(leaf: &LeafContent) -> Option<DisplayContent> {
    let leaf = match leaf {
        LeafContent::Text {
            text,
            parent_tool_use_id,
        } => {
            let text = strip_mainframe_command_tags(text);
            if text.is_empty() {
                return None;
            }
            LeafContent::Text {
                text,
                parent_tool_use_id: with_parent_id(parent_tool_use_id),
            }
        }
        LeafContent::Thinking {
            thinking,
            parent_tool_use_id,
        } if !thinking.trim().is_empty() => LeafContent::Thinking {
            thinking: thinking.clone(),
            parent_tool_use_id: with_parent_id(parent_tool_use_id),
        },
        LeafContent::Image {
            media_type,
            data,
            parent_tool_use_id,
        } => LeafContent::Image {
            media_type: media_type.clone(),
            data: data.clone(),
            parent_tool_use_id: with_parent_id(parent_tool_use_id),
        },
        _ => return None,
    };
    Some(DisplayContent::Leaf(leaf))
}

fn convert_tool(
    block: &MessageContent,
    result: Option<&MessageContent>,
    categories: Option<&ToolCategories>,
) -> Option<DisplayContent> {
    let MessageContent::Node(MessageContentNode::ToolUse {
        id,
        name,
        input,
        command_execution,
        parent_tool_use_id,
        ..
    }) = block
    else {
        return None;
    };
    let category = if name == "AskUserQuestion" && result.is_some() {
        ToolCategory::Default
    } else {
        categorize_tool_call(name, categories)
    };
    Some(DisplayContent::Node(DisplayNode::ToolCall {
        timing: None,
        id: id.clone(),
        name: name.clone(),
        input: input.clone(),
        command_execution: command_execution.clone().map(Box::new),
        category,
        result: result.and_then(|r| to_tool_call_result(r, Some(name), Some(input))),
        parent_tool_use_id: with_parent_id(parent_tool_use_id),
    }))
}

pub fn convert_assistant_content(
    grouped: &GroupedMessage,
    categories: Option<&ToolCategories>,
) -> Vec<DisplayContent> {
    convert_assistant_with_sources(grouped, categories).0
}
