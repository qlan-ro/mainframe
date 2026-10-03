use mainframe_types::chat::{ChatMessage, MessageContent, MessageContentNode};
use mainframe_types::content::LeafContent;
use mainframe_types::transcript_presentation::*;
use serde_json::Value;
use std::collections::HashMap;

pub(super) fn sources(meta: Option<&HashMap<String, Value>>) -> Option<DisplayPresentationSources> {
    DisplayPresentationSources::from_value(meta?.get(PRESENTATION_SOURCES_KEY)?)
}

pub(super) fn initialize(message: &mut ChatMessage) {
    let Some(meta) = message.metadata.as_mut() else {
        return;
    };
    let Some(value) = meta.get(PRESENTATION_CONTEXT_KEY) else {
        return;
    };
    let Ok(presentation) = serde_json::from_value::<TranscriptPresentation>(value.clone()) else {
        return;
    };
    if !presentation.is_valid() {
        return;
    }
    let streaming = meta
        .get("presentationStreaming")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let entries = message
        .content
        .iter()
        .enumerate()
        .filter(|(_, block)| matches_parent(block, presentation.parent_tool_use_id.as_deref()))
        .map(|(index, _)| DisplayPresentationSource {
            identity: PresentationSourceIdentity {
                source_message_id: message.id.clone(),
                source_block_index: index,
                presentation: presentation.clone(),
                streaming: Some(streaming),
            },
            path: vec![index],
        })
        .collect();
    store(meta, entries);
}

pub(super) fn store(meta: &mut HashMap<String, Value>, sources: Vec<DisplayPresentationSource>) {
    if sources.is_empty() {
        meta.remove(PRESENTATION_SOURCES_KEY);
        return;
    }
    if let Ok(value) = serde_json::to_value(DisplayPresentationSources {
        version: 1,
        sources,
    }) {
        meta.insert(PRESENTATION_SOURCES_KEY.into(), value);
    }
}

pub(super) fn append(previous: &mut ChatMessage, next: &ChatMessage) {
    let Some(mut next_sources) = sources(next.metadata.as_ref()) else {
        return;
    };
    for source in &mut next_sources.sources {
        source.path[0] += previous.content.len();
    }
    let value = previous
        .metadata
        .get_or_insert_default()
        .entry(PRESENTATION_SOURCES_KEY.into())
        .or_insert_with(|| serde_json::json!({"version":1,"sources":[]}));
    if let Some(entries) = value.get_mut("sources").and_then(Value::as_array_mut) {
        entries.extend(
            next_sources
                .sources
                .into_iter()
                .filter_map(|s| serde_json::to_value(s).ok()),
        );
    }
}

pub(super) fn retain(message: &mut ChatMessage, retained: &[usize]) {
    let Some(mut source) = sources(message.metadata.as_ref()) else {
        return;
    };
    let indices: HashMap<_, _> = retained
        .iter()
        .enumerate()
        .map(|(new, old)| (*old, new))
        .collect();
    source.sources.retain_mut(|s| {
        if let Some(index) = indices.get(&s.path[0]).copied() {
            s.path[0] = index;
            true
        } else {
            false
        }
    });
    store(message.metadata.get_or_insert_default(), source.sources);
}

fn matches_parent(block: &MessageContent, expected: Option<&str>) -> bool {
    let parent = match block {
        MessageContent::Leaf(
            LeafContent::Text {
                parent_tool_use_id, ..
            }
            | LeafContent::Thinking {
                parent_tool_use_id, ..
            }
            | LeafContent::Image {
                parent_tool_use_id, ..
            },
        ) => parent_tool_use_id,
        MessageContent::Node(MessageContentNode::ToolUse {
            parent_tool_use_id, ..
        }) => parent_tool_use_id,
        _ => return false,
    };
    parent.as_deref().filter(|s| !s.is_empty()) == expected
}
