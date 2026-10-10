//! Shared update types: `ProcessedAttachments` and the unified `ChatUpdate` patch.
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

/// Unified `db.chats.update` patch (superset of the sub-manager patch structs).
/// Tri-state fields use `Some(None)` for an explicit null.
pub use mainframe_types::chat_patch::ChatPatch as ChatUpdate;
