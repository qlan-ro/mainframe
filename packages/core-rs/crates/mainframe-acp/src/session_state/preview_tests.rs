//! Replay result previews on the diff state: a previewed id is trimmed on every
//! path that stores an item — seed, `diff`, and the incremental container
//! `apply` — so a later full re-encode of a settled container emits nothing,
//! while a real change still reaches the client in its trimmed form and
//! un-previewed items are untouched.

use std::collections::HashSet;

use mainframe_types::acp::content::ContentBlock;
use mainframe_types::acp::tool_call::{ToolCallContent, ToolCallStatus, ToolKind};
use mainframe_types::acp::update::SessionUpdate;
use serde_json::json;

use super::SessionState;
use crate::encoder::EncodedItem;
use crate::encoder::delta::EncodedDelta;
use crate::replay_previews::{PREVIEW_BYTES, preview_item};

fn result(text: &str) -> Vec<ToolCallContent> {
    vec![ToolCallContent::Content {
        content: ContentBlock::Text {
            text: text.to_string(),
            meta: None,
        },
    }]
}

fn tool(id: &str, text: &str) -> EncodedItem {
    EncodedItem::ToolCall {
        id: id.to_string(),
        title: "Bash".to_string(),
        kind: ToolKind::Execute,
        status: ToolCallStatus::Completed,
        raw_input: json!({ "command": "ls" }),
        content: result(text),
        meta: None,
    }
}

fn previews(ids: &[&str]) -> HashSet<String> {
    ids.iter().map(|id| id.to_string()).collect()
}

fn big() -> String {
    "z".repeat(PREVIEW_BYTES * 2)
}

#[test]
fn a_previewed_id_replays_trimmed_and_an_un_previewed_one_in_full() {
    let mut state = SessionState::new();
    state.set_previews(previews(&["old"]));

    let updates = state.diff(&[tool("old", &big()), tool("new", &big())]);

    let [
        SessionUpdate::ToolCallUpdate(old),
        SessionUpdate::ToolCallUpdate(new),
    ] = updates.as_slice()
    else {
        panic!("expected two tool-call creates, got {updates:?}");
    };
    let trimmed = old.content.as_ref().unwrap().as_ref().unwrap();
    let full = new.content.as_ref().unwrap().as_ref().unwrap();
    let ToolCallContent::Content {
        content: ContentBlock::Text { text, meta },
    } = &trimmed[0]
    else {
        panic!("expected text")
    };
    assert_eq!(text.len(), PREVIEW_BYTES);
    assert_eq!(
        meta.as_ref().unwrap()["_mainframe.dev"],
        json!({ "truncated": true, "fullBytes": PREVIEW_BYTES * 2 })
    );
    let ToolCallContent::Content {
        content: ContentBlock::Text { text, meta },
    } = &full[0]
    else {
        panic!("expected text")
    };
    assert_eq!(text.len(), PREVIEW_BYTES * 2);
    assert_eq!(meta, &None);
}

#[test]
fn a_full_re_encode_of_a_previewed_item_after_seeding_emits_nothing() {
    let containers = vec![vec![tool("old", &big())], vec![tool("new", "ok")]];
    let mut state = SessionState::new();
    state.set_previews(previews(&["old"]));
    state.seed_containers(&containers);

    // The live projection re-encodes the whole chat with the same content.
    assert!(
        state
            .diff(&[tool("old", &big()), tool("new", "ok")])
            .is_empty()
    );
    let delta = EncodedDelta::full(containers.clone());
    assert!(state.apply(&delta, || containers.clone()).is_empty());
}

#[test]
fn a_real_change_to_a_previewed_item_reaches_the_client_trimmed() {
    let mut state = SessionState::new();
    state.set_previews(previews(&["old"]));
    state.seed_containers(&[vec![tool("old", &big())]]);

    let changed = tool("old", &format!("{}CHANGED", big()));
    let delta = EncodedDelta {
        full: false,
        changes: vec![(0, vec![changed.clone()])],
        len: 1,
    };
    let updates = state.apply(&delta, || unreachable!("seeded"));

    let [SessionUpdate::ToolCallUpdate(patch)] = updates.as_slice() else {
        panic!("expected one patch, got {updates:?}");
    };
    let EncodedItem::ToolCall {
        content: expected, ..
    } = preview_item(&changed)
    else {
        unreachable!()
    };
    // The change sits past the cut, so the preview text is unchanged — but
    // its `fullBytes` grew, and that trimmed form (never the full text) is
    // what reaches the client. Re-storing it leaves the state converged.
    assert_eq!(patch.content, Some(Some(expected)));
    assert!(state.diff(&[changed]).is_empty());
}

#[test]
fn a_previewed_id_that_changes_within_the_preview_window_patches_the_trimmed_content() {
    let mut state = SessionState::new();
    state.set_previews(previews(&["old"]));
    state.seed_containers(&[vec![tool("old", &big())]]);

    let changed = tool("old", &format!("CHANGED{}", big()));
    let updates = state.diff(std::slice::from_ref(&changed));
    let [SessionUpdate::ToolCallUpdate(patch)] = updates.as_slice() else {
        panic!("expected one patch, got {updates:?}");
    };
    let EncodedItem::ToolCall {
        content: expected, ..
    } = preview_item(&changed)
    else {
        unreachable!()
    };
    assert_eq!(patch.content, Some(Some(expected)));
}
