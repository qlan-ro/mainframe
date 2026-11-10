use super::*;

/// Everything the plain-text tail needs from attachment processing, with the
/// typed text already folded in.
pub(super) struct Outgoing {
    pub(super) images: Vec<ImageInput>,
    pub(super) attachment_previews: Vec<serde_json::Value>,
    pub(super) message_content: Vec<MessageContent>,
    pub(super) text: String,
}

impl ChatManager {
    pub(super) async fn prepare_outgoing(
        &self,
        chat_id: &str,
        content: &str,
        attachment_ids: Option<&[String]>,
    ) -> Outgoing {
        let ProcessedAttachments {
            images,
            mut message_content,
            text_prefix,
            attachment_previews,
        } = match attachment_ids {
            Some(ids) if !ids.is_empty() => {
                self.shared.deps.process_attachments(chat_id, ids).await
            }
            _ => ProcessedAttachments::default(),
        };
        if !content.is_empty() {
            message_content.push(MessageContent::Leaf(LeafContent::Text {
                text: content.to_string(),
                parent_tool_use_id: None,
            }));
        }
        let text = if !text_prefix.is_empty() {
            if content.is_empty() {
                text_prefix.join("\n")
            } else {
                format!("{}\n\n{}", text_prefix.join("\n"), content)
            }
        } else {
            content.to_string()
        };
        Outgoing {
            images,
            attachment_previews,
            message_content,
            text,
        }
    }
}
