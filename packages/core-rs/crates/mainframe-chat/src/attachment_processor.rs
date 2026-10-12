//! Pure transform: already-fetched attachments → the `ProcessedAttachments`
//! the sendMessage seam feeds to the adapter. Images become inline `image`
//! content (plus `ImageInput`s for adapters that take images out-of-band);
//! files become `<attached_file_path .../>` text prefixes. Every attachment
//! also contributes a preview object for the message's transient metadata.

use mainframe_adapter_api::ImageInput;
use mainframe_services::attachment::attachment_store::AttachmentKind;
use mainframe_services::attachment::{StoredAttachment, build_attached_file_path_tag};
use mainframe_types::chat::MessageContent;
use mainframe_types::content::LeafContent;

use crate::chat_manager::ProcessedAttachments;

pub fn process_attachments(attachments: &[StoredAttachment]) -> ProcessedAttachments {
    let mut out = ProcessedAttachments::default();
    for attachment in attachments {
        out.attachment_previews.push(build_preview(attachment));
        match attachment.kind {
            AttachmentKind::Image => {
                out.images.push(ImageInput {
                    media_type: attachment.media_type.clone(),
                    data: attachment.data.clone(),
                    path: attachment.materialized_path.clone(),
                });
                out.message_content
                    .push(MessageContent::Leaf(LeafContent::Image {
                        media_type: attachment.media_type.clone(),
                        data: attachment.data.clone(),
                        parent_tool_use_id: None,
                    }));
            }
            AttachmentKind::File => {
                out.text_prefix
                    .push(build_attached_file_path_tag(attachment));
            }
        }
    }
    out
}

/// Builds the `attachmentPreviews` object with
/// camelCase keys, omitting the path fields when absent (JSON.stringify drops
/// `undefined`).
fn build_preview(attachment: &StoredAttachment) -> serde_json::Value {
    let mut preview = serde_json::Map::new();
    preview.insert(
        "name".into(),
        serde_json::Value::String(attachment.name.clone()),
    );
    preview.insert(
        "mediaType".into(),
        serde_json::Value::String(attachment.media_type.clone()),
    );
    preview.insert(
        "sizeBytes".into(),
        serde_json::Value::from(attachment.size_bytes),
    );
    preview.insert(
        "kind".into(),
        serde_json::to_value(attachment.kind).unwrap_or(serde_json::Value::Null),
    );
    if let Some(path) = &attachment.original_path {
        preview.insert(
            "originalPath".into(),
            serde_json::Value::String(path.clone()),
        );
    }
    // The materialized image path is a daemon-local delivery detail for the
    // Codex adapter, not part of the client preview contract; file-kind keeps it.
    if attachment.kind == AttachmentKind::File
        && let Some(path) = &attachment.materialized_path
    {
        preview.insert(
            "materializedPath".into(),
            serde_json::Value::String(path.clone()),
        );
    }
    serde_json::Value::Object(preview)
}

#[cfg(test)]
#[path = "attachment_processor_tests.rs"]
mod tests;
