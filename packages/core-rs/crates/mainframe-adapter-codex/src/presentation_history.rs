use crate::thread_registry::AgentMetadata;
use crate::transcript_presentation::{context, item_phase};
use crate::types::{ThreadItem, ThreadReadTurn};
use mainframe_types::chat::{ChatMessage, ChatMessageType};
use mainframe_types::transcript_presentation::*;
use std::collections::HashMap;

pub(crate) fn convert_turns(
    turns: &[ThreadReadTurn],
    thread: &str,
    children: &HashMap<String, Vec<ThreadItem>>,
    agents: &HashMap<String, AgentMetadata>,
) -> Vec<ChatMessage> {
    let items: Vec<_> = turns.iter().flat_map(|t| t.items.iter().cloned()).collect();
    let mut messages =
        crate::history_convert::convert_thread_items(&items, thread, children, agents);
    let membership = membership(turns, thread);
    for message in &mut messages {
        if message.r#type != ChatMessageType::Assistant {
            continue;
        }
        if let Some(Some(context)) = membership.get(&message.id)
            && let Ok(value) = serde_json::to_value(context)
        {
            message
                .metadata
                .get_or_insert_default()
                .insert(PRESENTATION_CONTEXT_KEY.into(), value);
        }
    }
    messages
}
fn membership(
    turns: &[ThreadReadTurn],
    thread: &str,
) -> HashMap<String, Option<TranscriptPresentation>> {
    let mut result = HashMap::new();
    for turn in turns {
        let Some(base) = context(thread, &turn.id, None, &turn.status, &turn.timing) else {
            continue;
        };
        for item in &turn.items {
            let Ok(value) = serde_json::to_value(item) else {
                continue;
            };
            let (phase, eligible) = item_phase(&value);
            let mut p = base.clone();
            p.phase = phase;
            p.final_eligible = eligible;
            for id in source_ids(item, &value) {
                result
                    .entry(id)
                    .and_modify(|previous| *previous = None)
                    .or_insert(Some(p.clone()));
            }
        }
    }
    result
}
fn source_ids(item: &ThreadItem, value: &serde_json::Value) -> Vec<String> {
    match item {
        ThreadItem::FileChange(f) => f
            .changes
            .iter()
            .enumerate()
            .map(|(i, _)| format!("{}:{i}", f.id))
            .collect(),
        ThreadItem::AgentMessage(_)
        | ThreadItem::Reasoning(_)
        | ThreadItem::CommandExecution(_)
        | ThreadItem::McpToolCall(_)
        | ThreadItem::DynamicToolCall(_)
        | ThreadItem::WebSearch(_)
        | ThreadItem::ImageGeneration(_) => value
            .get("id")
            .and_then(serde_json::Value::as_str)
            .filter(|id| !id.is_empty())
            .map(|id| vec![id.to_string()])
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}
