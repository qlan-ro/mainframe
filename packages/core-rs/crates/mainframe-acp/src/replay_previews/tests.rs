use mainframe_types::acp::tool_call::{ToolCallStatus, ToolKind};
use serde_json::json;

use super::*;
use crate::encoder::ItemRole;

fn text(text: &str, meta: Option<Value>) -> ToolCallContent {
    ToolCallContent::Content {
        content: ContentBlock::Text {
            text: text.to_string(),
            meta,
        },
    }
}

fn tool(id: &str, content: Vec<ToolCallContent>) -> EncodedItem {
    EncodedItem::ToolCall {
        id: id.to_string(),
        title: "Read".to_string(),
        kind: ToolKind::Read,
        status: ToolCallStatus::Completed,
        raw_input: json!({ "file_path": "/a" }),
        content,
        meta: None,
    }
}

fn message(id: &str) -> EncodedItem {
    EncodedItem::Message {
        id: id.to_string(),
        role: ItemRole::Agent,
        content: vec![ContentBlock::Text {
            text: "x".repeat(PREVIEW_BYTES * 2),
            meta: None,
        }],
        meta: None,
    }
}

fn marker(item: &EncodedItem) -> Option<Value> {
    let EncodedItem::ToolCall { content, .. } = item else {
        return None;
    };
    let ToolCallContent::Content {
        content: ContentBlock::Text { meta, .. },
    } = &content[0]
    else {
        return None;
    };
    meta.as_ref()?.get(MAINFRAME_META_NAMESPACE).cloned()
}

fn result_text(item: &EncodedItem) -> String {
    let EncodedItem::ToolCall { content, .. } = item else {
        panic!("not a tool call");
    };
    let ToolCallContent::Content {
        content: ContentBlock::Text { text, .. },
    } = &content[0]
    else {
        panic!("not a text result");
    };
    text.clone()
}

#[test]
fn previews_only_oversized_tool_results_outside_the_newest_containers() {
    let big = "y".repeat(PREVIEW_BYTES + 1);
    let mut containers: Vec<Vec<EncodedItem>> = Vec::new();
    containers.push(vec![tool("old-big", vec![text(&big, None)])]);
    containers.push(vec![tool("old-small", vec![text("fits", None)])]);
    containers.push(vec![message("old-message")]);
    for i in 0..FULL_RESULT_CONTAINERS {
        containers.push(vec![tool(&format!("new-{i}"), vec![text(&big, None)])]);
    }

    let ids = preview_ids(&containers);
    assert_eq!(ids, HashSet::from(["old-big".to_string()]));
}

#[test]
fn a_short_transcript_previews_nothing() {
    let big = "y".repeat(PREVIEW_BYTES + 1);
    let containers = vec![vec![tool("t1", vec![text(&big, None)])]];
    assert!(preview_ids(&containers).is_empty());
}

#[test]
fn preview_item_cuts_the_text_and_marks_it_truncated_with_the_full_length() {
    let big = format!("{}é", "a".repeat(PREVIEW_BYTES - 1));
    let item = tool("t1", vec![text(&big, None)]);

    let preview = preview_item(&item);
    let kept = result_text(&preview);
    // `é` is two bytes and straddles the cut, so the cut backs off to the char boundary before it.
    assert_eq!(kept.len(), PREVIEW_BYTES - 1);
    assert!(kept.chars().all(|c| c == 'a'));
    assert_eq!(
        marker(&preview),
        Some(json!({ "truncated": true, "fullBytes": big.len() }))
    );
}

#[test]
fn preview_item_keeps_an_existing_truncation_markers_full_bytes() {
    let big = "b".repeat(PREVIEW_BYTES * 3);
    let already = json!({ MAINFRAME_META_NAMESPACE: { "truncated": true, "fullBytes": 500_000, "askUserQuestion": [] } });
    let item = tool("t1", vec![text(&big, Some(already))]);

    let preview = preview_item(&item);
    assert_eq!(result_text(&preview).len(), PREVIEW_BYTES);
    assert_eq!(
        marker(&preview),
        Some(json!({ "truncated": true, "fullBytes": 500_000, "askUserQuestion": [] }))
    );
}

#[test]
fn preview_item_leaves_fitting_text_images_diffs_and_other_items_alone() {
    let image = ToolCallContent::Content {
        content: ContentBlock::Image {
            data: "c".repeat(PREVIEW_BYTES * 2),
            mime_type: "image/png".to_string(),
            uri: None,
            meta: None,
        },
    };
    let item = tool("t1", vec![text("fits", None), image.clone()]);
    assert_eq!(preview_item(&item), item);

    let msg = message("m1");
    assert_eq!(preview_item(&msg), msg);
}

#[test]
fn preview_item_is_idempotent() {
    let big = "d".repeat(PREVIEW_BYTES * 2);
    let item = tool("t1", vec![text(&big, None)]);
    let once = preview_item(&item);
    assert_eq!(preview_item(&once), once);
}
