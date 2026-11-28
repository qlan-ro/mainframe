//! Each image the parser reads is one allocation, shared by the raw history,
//! the display projection and the revision log instead of copied into each.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "Test assertions and scenarios"
)]

#[path = "image_wire/transcript.rs"]
mod transcript;

use mainframe_acp::{RevisionLog, encode};
use mainframe_display::incremental::IncrementalProjector;
use mainframe_display::{DisplayProjector, ProjectionInput};
use mainframe_types::chat::ChatMessage;
use transcript::{appended, load_raw};

/// Every image payload in the raw transcript, in order.
fn raw_images(raw: &[ChatMessage]) -> Vec<mainframe_types::shared_str::SharedStr> {
    use mainframe_types::chat::{MessageContent, MessageContentNode};
    use mainframe_types::content::LeafContent;
    let mut out = Vec::new();
    for block in raw.iter().flat_map(|message| &message.content) {
        match block {
            MessageContent::Leaf(LeafContent::Image { data, .. }) => out.push(data.clone()),
            MessageContent::Node(MessageContentNode::ToolResult { images, .. }) => {
                out.extend(images.iter().map(|image| image.data.clone()));
            }
            _ => {}
        }
    }
    out
}

/// Every image payload in an encoded item list, in order.
fn encoded_images(
    items: &[mainframe_acp::EncodedItem],
) -> Vec<mainframe_types::shared_str::SharedStr> {
    use mainframe_acp::EncodedItem;
    use mainframe_types::acp::content::ContentBlock;
    use mainframe_types::acp::tool_call::ToolCallContent;
    let mut out = Vec::new();
    for item in items {
        match item {
            EncodedItem::Message { content, .. } | EncodedItem::Thought { content, .. } => {
                for block in content {
                    if let ContentBlock::Image { data, .. } = block {
                        out.push(data.clone());
                    }
                }
            }
            EncodedItem::ToolCall { content, .. } => {
                for entry in content {
                    if let ToolCallContent::Content {
                        content: ContentBlock::Image { data, .. },
                    } = entry
                    {
                        out.push(data.clone());
                    }
                }
            }
        }
    }
    out
}

/// One allocation per parsed image, shared by the raw history, the
/// projector's single container copy, and the revision log's encoded item.
#[tokio::test]
async fn each_image_is_held_once_across_raw_history_projection_and_revision_log() {
    let raw = load_raw().await;
    let images = raw_images(&raw);
    assert_eq!(
        images.len(),
        5,
        "two prompt images and three tool-result images"
    );
    // Each payload has its own allocation, held by the raw message and the
    // handle collected above.
    assert!(images.iter().all(|image| image.strong_count() == 2));

    let mut projector = IncrementalProjector::new();
    let delta = projector.project(ProjectionInput {
        raw: &raw,
        overlay: None,
        categories: None,
        changes: appended(),
    });
    let items = delta.snapshot.read(encode);
    drop(delta);
    let mut log = RevisionLog::new("epoch-sharing".to_string());
    log.record(&items);

    // The encoded items point at the very allocations the parser made.
    let encoded = encoded_images(&items);
    assert_eq!(encoded.len(), images.len());
    for image in &encoded {
        assert!(images.iter().any(|raw_image| raw_image.ptr_eq(image)));
    }
    drop((encoded, items));

    // Raw message, projector container, revision-log item, and the handle
    // held here: four holders of one allocation, no copies.
    for image in &images {
        assert_eq!(image.strong_count(), 4);
    }

    // Releasing the projection and the log leaves the raw copy alone.
    drop((projector, log));
    assert!(images.iter().all(|image| image.strong_count() == 2));
}
