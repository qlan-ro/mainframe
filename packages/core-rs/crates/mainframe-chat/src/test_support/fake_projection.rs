//! The fake adapter port's raw-to-display projection.

use std::sync::Arc;

use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent};
use mainframe_types::display::{
    DisplayContent, DisplayMessage, DisplayMessageType, ToolCategories,
};

use super::FakeAdapterPort;

/// A test's own raw-to-display projection, installed as `projector`.
pub(crate) type ProjectorFn = Arc<
    dyn Fn(&[ChatMessage], Option<&ChatMessage>, Option<&ToolCategories>) -> Vec<DisplayMessage>
        + Send
        + Sync,
>;

impl FakeAdapterPort {
    /// A 1:1 echo (same id/timestamp/type, leaf content verbatim, `Node`
    /// content dropped) shared by `prepare_messages_for_client` and
    /// `display_projector`, so REST and live paths answer identically.
    pub(crate) fn convert(
        raw: &[ChatMessage],
        _categories: Option<&ToolCategories>,
    ) -> Vec<DisplayMessage> {
        raw.iter()
            .map(|m| DisplayMessage {
                id: m.id.clone(),
                chat_id: m.chat_id.clone(),
                r#type: match m.r#type {
                    ChatMessageType::User => DisplayMessageType::User,
                    ChatMessageType::Error => DisplayMessageType::Error,
                    ChatMessageType::Permission => DisplayMessageType::Permission,
                    ChatMessageType::System => DisplayMessageType::System,
                    _ => DisplayMessageType::Assistant,
                },
                content: m
                    .content
                    .iter()
                    .filter_map(|c| match c {
                        MessageContent::Leaf(leaf) => Some(DisplayContent::Leaf(leaf.clone())),
                        MessageContent::Node(_) => None,
                    })
                    .collect(),
                timestamp: m.timestamp.clone(),
                metadata: None,
            })
            .collect()
    }
}
