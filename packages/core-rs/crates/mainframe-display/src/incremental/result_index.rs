use std::collections::HashMap;

use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};

pub(crate) type ResultIndex<'a> = HashMap<&'a str, (usize, &'a MessageContent)>;

pub(crate) fn result_index(raw: &[ChatMessage]) -> ResultIndex<'_> {
    let mut results = HashMap::new();
    for (index, msg) in raw.iter().enumerate() {
        for (id, block) in result_blocks(msg) {
            results.insert(id, (index, block));
        }
    }
    results
}

pub(crate) fn result_blocks(msg: &ChatMessage) -> impl Iterator<Item = (&str, &MessageContent)> {
    msg.content.iter().filter_map(|block| match block {
        MessageContent::Node(MessageContentNode::ToolResult { tool_use_id, .. })
            if msg.r#type == ChatMessageType::ToolResult =>
        {
            Some((tool_use_id.as_str(), block))
        }
        _ => None,
    })
}
