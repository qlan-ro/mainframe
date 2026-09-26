//! Tool-result image tests for todo #363, split out of `history_tool_result.rs`
//! to keep that file under the 300-line cap.

use super::*;
use serde_json::json;

#[test]
fn image_only_content_yields_one_image_and_empty_text() {
    let content = json!([
        { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "AAAA" } }
    ]);
    let text = extract_tool_result_content(Some(&content));
    assert_eq!(text, "");
    assert!(!text.contains("AAAA"));
    assert!(!text.contains("base64"));

    let images = extract_tool_result_images(Some(&content));
    assert_eq!(
        images,
        vec![ToolResultImage {
            media_type: "image/png".to_string(),
            data: "AAAA".to_string(),
        }]
    );
}

#[test]
fn mixed_text_and_images_keeps_text_and_collects_both_images_in_order() {
    let content = json!([
        { "type": "text", "text": "here are two screenshots" },
        { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "FIRST" } },
        { "type": "image", "source": { "type": "base64", "media_type": "image/jpeg", "data": "SECOND" } }
    ]);
    assert_eq!(
        extract_tool_result_content(Some(&content)),
        "here are two screenshots"
    );
    assert_eq!(
        extract_tool_result_images(Some(&content)),
        vec![
            ToolResultImage {
                media_type: "image/png".to_string(),
                data: "FIRST".to_string(),
            },
            ToolResultImage {
                media_type: "image/jpeg".to_string(),
                data: "SECOND".to_string(),
            },
        ]
    );
}

#[test]
fn build_blocks_fills_images_field_from_tool_result_content() {
    let message = json!({
        "content": [
            {
                "type": "tool_result",
                "tool_use_id": "tu_img",
                "is_error": false,
                "content": [
                    { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "AAAA" } }
                ]
            }
        ]
    });
    let blocks = build_tool_result_blocks(&message, None);
    assert_eq!(blocks.len(), 1);
    match &blocks[0] {
        MessageContent::Node(MessageContentNode::ToolResult {
            content, images, ..
        }) => {
            assert_eq!(content, "");
            assert_eq!(images.len(), 1);
            assert_eq!(images[0].media_type, "image/png");
            assert_eq!(images[0].data, "AAAA");
        }
        _ => panic!("expected tool_result"),
    }
}

#[test]
fn non_text_non_image_array_keeps_json_fallback() {
    // A non-text array that is not image-only still falls back to
    // JSON.stringify — only image-only arrays become "".
    let content = json!([{ "type": "unknown_block", "value": 1 }]);
    let text = extract_tool_result_content(Some(&content));
    assert_eq!(text, serde_json::to_string(&content).unwrap());
}
