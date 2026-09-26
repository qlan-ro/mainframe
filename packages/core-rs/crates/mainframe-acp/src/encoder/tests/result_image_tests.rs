//! Tool-result image encoding cases (todo #363), split out of
//! `result_content_tests.rs` to keep that file under the 300-line cap.

use std::collections::HashMap;

use mainframe_types::display::{
    DisplayContent, DisplayMessageType, DisplayNode, ToolCallResult, ToolCategory,
};

use super::*;

fn image_result(images: Vec<mainframe_types::content::ToolResultImage>) -> ToolCallResult {
    ToolCallResult {
        content: String::new(),
        is_error: false,
        structured_patch: None,
        original_file: None,
        modified_file: None,
        truncated: None,
        full_bytes: None,
        ask_user_question: None,
        images,
    }
}

#[test]
fn a_result_with_images_encodes_one_image_entry_per_image_after_the_text_entry() {
    let images = vec![
        mainframe_types::content::ToolResultImage {
            media_type: "image/png".to_string(),
            data: "AAAA".to_string(),
        },
        mainframe_types::content::ToolResultImage {
            media_type: "image/jpeg".to_string(),
            data: "BBBB".to_string(),
        },
    ];
    let messages = vec![dmsg(
        "dmsg_9",
        DisplayMessageType::Assistant,
        vec![DisplayContent::Node(DisplayNode::ToolCall {
            id: "toolu_img_1".to_string(),
            name: "Read".to_string(),
            input: HashMap::new(),
            category: ToolCategory::Explore,
            result: Some(image_result(images)),
            parent_tool_use_id: None,
        })],
    )];

    let items = encode(&messages);
    let EncodedItem::ToolCall { content, .. } = &items[0] else {
        panic!("expected a tool call");
    };
    assert_eq!(content.len(), 3);
    assert!(matches!(
        &content[0],
        ToolCallContent::Content {
            content: ContentBlock::Text { .. }
        }
    ));
    let ToolCallContent::Content {
        content: ContentBlock::Image {
            data, mime_type, ..
        },
    } = &content[1]
    else {
        panic!("expected the first image content entry");
    };
    assert_eq!(data, "AAAA");
    assert_eq!(mime_type, "image/png");
    let ToolCallContent::Content {
        content: ContentBlock::Image {
            data, mime_type, ..
        },
    } = &content[2]
    else {
        panic!("expected the second image content entry");
    };
    assert_eq!(data, "BBBB");
    assert_eq!(mime_type, "image/jpeg");
}

#[test]
fn a_result_without_images_encodes_byte_identically_to_today() {
    let items = encode(&[dmsg(
        "dmsg_10",
        DisplayMessageType::Assistant,
        vec![tool_call(
            "toolu_2",
            "Read",
            ToolCategory::Explore,
            Some("plain text result"),
        )],
    )]);
    let EncodedItem::ToolCall { content, .. } = &items[0] else {
        panic!("expected a tool call");
    };
    assert_eq!(content.len(), 1);
    assert!(matches!(
        &content[0],
        ToolCallContent::Content {
            content: ContentBlock::Text { .. }
        }
    ));
}
