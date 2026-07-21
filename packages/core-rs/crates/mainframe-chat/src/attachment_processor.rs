//! Ported from `packages/core/src/chat/attachment-processor.ts`.
//!
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

/// Mirrors the `attachmentPreviews` object in attachment-processor.ts —
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
    if let Some(path) = &attachment.materialized_path {
        preview.insert(
            "materializedPath".into(),
            serde_json::Value::String(path.clone()),
        );
    }
    serde_json::Value::Object(preview)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn image(name: &str, media_type: &str, data: &str) -> StoredAttachment {
        StoredAttachment {
            name: name.to_string(),
            media_type: media_type.to_string(),
            size_bytes: 128,
            kind: AttachmentKind::Image,
            data: data.to_string(),
            original_path: None,
            materialized_path: None,
        }
    }

    fn file(name: &str) -> StoredAttachment {
        StoredAttachment {
            name: name.to_string(),
            media_type: "text/plain".to_string(),
            size_bytes: 10,
            kind: AttachmentKind::File,
            data: String::new(),
            original_path: Some("/tmp/notes.txt".to_string()),
            materialized_path: None,
        }
    }

    #[test]
    fn image_becomes_inline_content_and_image_input() {
        let out = process_attachments(&[image("shot.png", "image/png", "BASE64DATA")]);

        assert_eq!(out.images.len(), 1);
        assert_eq!(out.images[0].media_type, "image/png");
        assert_eq!(out.images[0].data, "BASE64DATA");

        assert_eq!(out.message_content.len(), 1);
        assert_eq!(
            out.message_content[0],
            MessageContent::Leaf(LeafContent::Image {
                media_type: "image/png".to_string(),
                data: "BASE64DATA".to_string(),
                parent_tool_use_id: None,
            })
        );
        assert!(out.text_prefix.is_empty());
    }

    #[test]
    fn file_becomes_text_prefix_tag_not_image() {
        let out = process_attachments(&[file("notes.txt")]);

        assert!(out.images.is_empty());
        assert!(out.message_content.is_empty());
        assert_eq!(
            out.text_prefix,
            vec![
                "<attached_file_path name=\"notes.txt\" path=\"/tmp/notes.txt\" media_type=\"text/plain\" size_bytes=\"10\" />"
                    .to_string()
            ]
        );
    }

    #[test]
    fn preview_carries_camelcase_fields_and_omits_absent_paths() {
        let out = process_attachments(&[image("shot.png", "image/png", "X")]);
        assert_eq!(
            out.attachment_previews[0],
            json!({
                "name": "shot.png",
                "mediaType": "image/png",
                "sizeBytes": 128,
                "kind": "image",
            })
        );
    }

    #[test]
    fn preview_includes_original_path_when_present() {
        let out = process_attachments(&[file("notes.txt")]);
        assert_eq!(
            out.attachment_previews[0],
            json!({
                "name": "notes.txt",
                "mediaType": "text/plain",
                "sizeBytes": 10,
                "kind": "file",
                "originalPath": "/tmp/notes.txt",
            })
        );
    }

    #[test]
    fn mixed_batch_preserves_order_and_kinds() {
        let out = process_attachments(&[
            image("a.png", "image/png", "AA"),
            file("b.txt"),
            image("c.jpg", "image/jpeg", "CC"),
        ]);

        assert_eq!(out.images.len(), 2);
        assert_eq!(out.images[0].data, "AA");
        assert_eq!(out.images[1].data, "CC");
        assert_eq!(out.message_content.len(), 2);
        assert_eq!(out.text_prefix.len(), 1);
        assert_eq!(out.attachment_previews.len(), 3);
    }

    #[test]
    fn empty_input_yields_default() {
        let out = process_attachments(&[]);
        assert!(out.images.is_empty());
        assert!(out.message_content.is_empty());
        assert!(out.text_prefix.is_empty());
        assert!(out.attachment_previews.is_empty());
    }
}
