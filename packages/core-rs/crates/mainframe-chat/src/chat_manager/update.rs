//! `ProcessedAttachments`: the attachments prepared for a chat send.
use super::*;

/// Attachments prepared for a chat send.
#[derive(Debug, Clone, Default)]
pub struct ProcessedAttachments {
    pub images: Vec<ImageInput>,
    pub message_content: Vec<MessageContent>,
    pub text_prefix: Vec<String>,
    /// Opaque preview objects (`attachmentPreviews`), stored as JSON for the
    /// transient metadata; their shape is owned by the attachment layer.
    pub attachment_previews: Vec<serde_json::Value>,
}
