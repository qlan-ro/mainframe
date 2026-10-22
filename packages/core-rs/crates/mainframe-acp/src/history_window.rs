use mainframe_types::acp::extensions::{HistoryState, HistoryWindow, MAINFRAME_META_NAMESPACE};
use mainframe_types::display::{DisplayMessage, DisplayMessageType, StreamingLeafKind};

use crate::encoder::{self, EncodedItem, ItemRole};

pub const DEFAULT_CONTAINERS: usize = 40;

pub fn parse_window(meta: Option<&serde_json::Value>) -> Result<HistoryWindow, serde_json::Error> {
    meta.and_then(|meta| meta.get(MAINFRAME_META_NAMESPACE))
        .and_then(|ns| ns.get("window"))
        .map(|window| serde_json::from_value(window.clone()))
        .unwrap_or_else(|| Ok(HistoryWindow::default()))
}

pub fn page_size(count: Option<i64>) -> usize {
    count.unwrap_or(DEFAULT_CONTAINERS as i64).clamp(1, 200) as usize
}

pub fn snap(messages: &[DisplayMessage], start: usize) -> usize {
    (start.saturating_sub(8)..=start)
        .rev()
        .find(|&index| {
            messages
                .get(index)
                .is_some_and(|m| m.r#type == DisplayMessageType::User)
        })
        .unwrap_or(start)
}

pub fn snap_encoded(containers: &[Vec<EncodedItem>], start: usize) -> usize {
    (start.saturating_sub(8)..=start)
        .rev()
        .find(|&index| {
            containers.get(index).is_some_and(|items| {
                matches!(
                    items.first(),
                    Some(EncodedItem::Message {
                        role: ItemRole::User,
                        ..
                    })
                )
            })
        })
        .unwrap_or(start)
}

pub fn encode_range(
    messages: &[DisplayMessage],
    streaming: Option<StreamingLeafKind>,
    start: usize,
    end: usize,
) -> Vec<Vec<EncodedItem>> {
    let tail = messages.iter().rposition(|message| !is_queued(message));
    messages[start..end]
        .iter()
        .enumerate()
        .map(|(offset, message)| {
            encoder::encode_container(
                message,
                if tail == Some(start + offset) {
                    streaming
                } else {
                    None
                },
            )
        })
        .collect()
}

pub fn state(start: usize, containers: &[Vec<EncodedItem>]) -> HistoryState {
    HistoryState {
        has_more: start > 0,
        floor_item_id: containers
            .iter()
            .flatten()
            .next()
            .map(|item| item.id().to_string()),
        context_item_ids: None,
    }
}

pub fn find_item(messages: &[DisplayMessage], id: &str) -> Option<usize> {
    messages
        .iter()
        .position(|message| message.id == id)
        .or_else(|| {
            messages.iter().position(|message| {
                let candidate = id
                    .strip_prefix(&message.id)
                    .is_some_and(|suffix| suffix.starts_with('-'))
                    || contains_id(&message.content, id);
                candidate
                    && encoder::encode_container(message, None)
                        .iter()
                        .any(|item| item.id() == id)
            })
        })
}

fn contains_id(content: &[mainframe_types::display::DisplayContent], id: &str) -> bool {
    use mainframe_types::display::{DisplayContent, DisplayNode};
    content.iter().any(|block| match block {
        DisplayContent::Node(DisplayNode::ToolCall { id: tool_id, .. }) => tool_id == id,
        DisplayContent::Node(DisplayNode::ToolGroup { calls }) => contains_id(calls, id),
        DisplayContent::Node(DisplayNode::TaskGroup {
            agent_id, calls, ..
        }) => {
            agent_id == id
                || id
                    .strip_prefix(agent_id)
                    .is_some_and(|suffix| suffix.starts_with('-'))
                || contains_id(calls, id)
        }
        DisplayContent::Node(DisplayNode::TaskProgress { items }) => {
            items.iter().any(|item| item.id == id)
        }
        _ => false,
    })
}

fn is_queued(message: &DisplayMessage) -> bool {
    message
        .metadata
        .as_ref()
        .and_then(|meta| meta.get("queued"))
        .and_then(serde_json::Value::as_bool)
        == Some(true)
}
