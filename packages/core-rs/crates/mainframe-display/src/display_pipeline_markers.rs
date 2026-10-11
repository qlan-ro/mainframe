use super::display_helpers::with_parent_id;
use super::message_grouping::GroupedMessage;
use mainframe_types::chat::{ChatMessageType, MessageContent, MessageContentNode};
use mainframe_types::content::LeafContent;
use mainframe_types::display::{DisplayContent, DisplayMessage, DisplayMessageType, DisplayNode};

pub(super) fn convert_marker(msg: &GroupedMessage) -> DisplayMessage {
    let content = msg
        .base
        .content
        .iter()
        .map(|c| marker_content(msg.base.r#type, c))
        .collect();
    DisplayMessage {
        id: msg.base.id.clone(),
        chat_id: msg.base.chat_id.clone(),
        timestamp: msg.base.timestamp.clone(),
        r#type: match msg.base.r#type {
            ChatMessageType::System => DisplayMessageType::System,
            ChatMessageType::Error => DisplayMessageType::Error,
            _ => DisplayMessageType::Permission,
        },
        content,
        metadata: msg.base.metadata.clone(),
    }
}

fn marker_content(kind: ChatMessageType, content: &MessageContent) -> DisplayContent {
    match (kind, content) {
        (
            ChatMessageType::System,
            MessageContent::Leaf(LeafContent::Text {
                text,
                parent_tool_use_id,
            }),
        ) => DisplayContent::Leaf(LeafContent::Text {
            text: text.clone(),
            parent_tool_use_id: with_parent_id(parent_tool_use_id),
        }),
        (
            ChatMessageType::System,
            MessageContent::Leaf(LeafContent::SkillLoaded {
                skill_name,
                path,
                content,
                parent_tool_use_id,
            }),
        ) => DisplayContent::Leaf(LeafContent::SkillLoaded {
            skill_name: skill_name.clone(),
            path: path.clone(),
            content: content.clone(),
            parent_tool_use_id: with_parent_id(parent_tool_use_id),
        }),
        (ChatMessageType::System, MessageContent::Node(MessageContentNode::Compaction { .. })) => {
            DisplayContent::Node(DisplayNode::Compaction {
                parent_tool_use_id: None,
            })
        }
        (
            ChatMessageType::System,
            MessageContent::Node(MessageContentNode::ProviderSwitch { marker }),
        ) => DisplayContent::Node(DisplayNode::ProviderSwitch {
            marker: marker.clone(),
        }),
        (
            ChatMessageType::Error,
            MessageContent::Node(MessageContentNode::Error { message, .. }),
        ) => DisplayContent::Node(DisplayNode::Error {
            message: message.clone(),
        }),
        (
            ChatMessageType::Permission,
            MessageContent::Node(MessageContentNode::PermissionRequest { request, .. }),
        ) => DisplayContent::Node(DisplayNode::PermissionRequest {
            request: request.clone(),
            parent_tool_use_id: None,
        }),
        _ => empty_text(),
    }
}

fn empty_text() -> DisplayContent {
    DisplayContent::Leaf(LeafContent::Text {
        text: String::new(),
        parent_tool_use_id: None,
    })
}
