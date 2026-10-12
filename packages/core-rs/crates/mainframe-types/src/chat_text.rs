use crate::chat::{ChatMessage, ChatMessageType, MessageContent};
use crate::content::LeafContent;

pub fn last_assistant_text(messages: &[ChatMessage]) -> String {
    for message in messages.iter().rev() {
        if message.r#type != ChatMessageType::Assistant {
            continue;
        }
        for block in message.content.iter().rev() {
            if let MessageContent::Leaf(LeafContent::Text { text, .. }) = block {
                let text = text.trim();
                if !text.is_empty() {
                    return text.to_string();
                }
            }
        }
    }
    String::new()
}

pub fn with_ellipsis(text: &str) -> String {
    format!("{text}\u{2026}")
}

pub fn truncate_with_ellipsis(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let head: String = text.chars().take(max_chars.saturating_sub(1)).collect();
    with_ellipsis(&head)
}

#[cfg(test)]
mod tests {
    use super::truncate_with_ellipsis;

    #[test]
    fn selects_last_nonempty_assistant_text_block() {
        use crate::chat::{ChatMessage, ChatMessageType, MessageContent};
        use crate::content::LeafContent;
        let message = ChatMessage {
            id: "m1".into(),
            chat_id: "c1".into(),
            r#type: ChatMessageType::Assistant,
            content: vec![
                MessageContent::Leaf(LeafContent::Text {
                    text: " first ".into(),
                    parent_tool_use_id: None,
                }),
                MessageContent::Leaf(LeafContent::Text {
                    text: " final answer ".into(),
                    parent_tool_use_id: None,
                }),
            ],
            timestamp: "2026-10-10T00:00:00.000Z".into(),
            metadata: None,
        };
        assert_eq!(super::last_assistant_text(&[message]), "final answer");
    }

    #[test]
    fn truncates_at_character_boundary_with_one_ellipsis() {
        assert_eq!(truncate_with_ellipsis("abcd", 3), "ab…");
        assert_eq!(truncate_with_ellipsis("éx", 2), "éx");
    }
}
