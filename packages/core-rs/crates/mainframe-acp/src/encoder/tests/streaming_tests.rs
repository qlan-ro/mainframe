//! `encode_revision`'s streaming mark (spec Decision 39, todo #350 R2): only
//! the accumulator segment still open at `finish`, for the leaf kind the
//! partial-message overlay backs, carries `ItemMeta.streaming: true`. Split
//! out of `tests.rs` (plan task 37, R2.13) — shares its fixture builders via
//! `use super::*`.

use mainframe_types::display::{DisplayMessageType, StreamingLeafKind, ToolCategory};

use super::*;

/// Reads `ItemMeta.streaming` back off an encoded item's wrapped `_meta`.
fn item_streaming(item: &EncodedItem) -> bool {
    let meta = match item {
        EncodedItem::Message { meta, .. }
        | EncodedItem::Thought { meta, .. }
        | EncodedItem::ToolCall { meta, .. } => meta,
    };
    meta.as_ref()
        .and_then(|v| v.get(MAINFRAME_META_NAMESPACE))
        .and_then(|ns| ns.get("streaming"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn strip_streaming(meta: Option<Value>) -> Option<Value> {
    meta.map(|mut v| {
        if let Some(ns) = v
            .get_mut(MAINFRAME_META_NAMESPACE)
            .and_then(Value::as_object_mut)
        {
            ns.remove("streaming");
        }
        v
    })
}

/// Normalizes away the `streaming` key so a live, streaming encode can be
/// compared against a plain `encode` (resume replay's path, which never sets
/// it) for everything BUT the flag.
fn without_streaming(items: Vec<EncodedItem>) -> Vec<EncodedItem> {
    items
        .into_iter()
        .map(|item| match item {
            EncodedItem::Message {
                id,
                role,
                content,
                meta,
            } => EncodedItem::Message {
                id,
                role,
                content,
                meta: strip_streaming(meta),
            },
            EncodedItem::Thought { id, content, meta } => EncodedItem::Thought {
                id,
                content,
                meta: strip_streaming(meta),
            },
            EncodedItem::ToolCall {
                id,
                title,
                kind,
                status,
                raw_input,
                content,
                meta,
            } => EncodedItem::ToolCall {
                id,
                title,
                kind,
                status,
                raw_input,
                content,
                meta: strip_streaming(meta),
            },
        })
        .collect()
}

#[test]
fn encode_revision_marks_only_the_overlay_segment() {
    let messages = vec![dmsg(
        "dmsg_seg",
        DisplayMessageType::Assistant,
        vec![
            text("A"),
            tool_call("toolu_1", "Read", ToolCategory::Explore, None),
            text("B"),
        ],
    )];

    let items = encode_revision(&messages, Some(StreamingLeafKind::Text));

    let ids: Vec<&str> = items.iter().map(EncodedItem::id).collect();
    assert_eq!(ids, vec!["dmsg_seg", "toolu_1", "dmsg_seg-1"]);
    assert!(
        !item_streaming(&items[0]),
        "the closed segment never streams"
    );
    assert!(!item_streaming(&items[1]), "a tool call never streams");
    assert!(
        item_streaming(&items[2]),
        "the segment still open at finish streams"
    );
}

#[test]
fn a_streaming_thought_marks_the_thought_segment() {
    let messages = vec![dmsg(
        "dmsg_thought",
        DisplayMessageType::Assistant,
        vec![thinking("pondering")],
    )];

    let items = encode_revision(&messages, Some(StreamingLeafKind::Thinking));

    assert_eq!(items.len(), 1);
    assert!(matches!(items[0], EncodedItem::Thought { .. }));
    assert!(item_streaming(&items[0]));
}

#[test]
fn encode_revision_without_streaming_equals_encode() {
    let messages = vec![
        dmsg("dmsg_1", DisplayMessageType::User, vec![text("hi")]),
        dmsg(
            "dmsg_2",
            DisplayMessageType::Assistant,
            vec![thinking("hmm"), text("done")],
        ),
    ];

    assert_eq!(encode_revision(&messages, None), encode(&messages));
}

/// A commit lands under the same item id the partial held — the diff engine
/// relies on this to see a meta patch or a chunk append, never a reset.
#[test]
fn commit_keeps_the_segment_id() {
    let partial = vec![dmsg(
        "dmsg_commit",
        DisplayMessageType::Assistant,
        vec![
            text("A"),
            tool_call("toolu_c", "Read", ToolCategory::Explore, None),
            text("B partial"),
        ],
    )];
    let committed = vec![dmsg(
        "dmsg_commit",
        DisplayMessageType::Assistant,
        vec![
            text("A"),
            tool_call("toolu_c", "Read", ToolCategory::Explore, None),
            text("B committed"),
        ],
    )];

    let partial_items = encode_revision(&partial, Some(StreamingLeafKind::Text));
    let committed_items = encode(&committed);

    assert_eq!(
        ids(&partial_items),
        vec!["dmsg_commit", "toolu_c", "dmsg_commit-1"]
    );
    assert_eq!(ids(&partial_items), ids(&committed_items));
}

fn ids(items: &[EncodedItem]) -> Vec<&str> {
    items.iter().map(EncodedItem::id).collect()
}

/// Live streaming and history replay must agree on ids/content/non-streaming
/// meta by construction (criterion 10) — `streaming` is the one field a
/// resume snapshot, which has no overlay, can never carry.
#[test]
fn streaming_ids_match_history() {
    let live = vec![dmsg(
        "dmsg_live",
        DisplayMessageType::Assistant,
        vec![
            text("A"),
            tool_call("toolu_live", "Read", ToolCategory::Explore, None),
            text("B"),
        ],
    )];
    let history = live.clone();

    let live_items = encode_revision(&live, Some(StreamingLeafKind::Text));
    let history_items = encode(&history);

    assert_eq!(without_streaming(live_items), history_items);
}

#[test]
fn a_new_turn_wait_keeps_the_previous_answer_settled_until_its_own_overlay() {
    for (kind, content, expected_id) in [
        (StreamingLeafKind::Text, text("new partial"), "next-answer"),
        (
            StreamingLeafKind::Thinking,
            thinking("new partial"),
            "next-answer-thought",
        ),
    ] {
        let mut messages = vec![
            dmsg(
                "previous",
                DisplayMessageType::Assistant,
                vec![text("done")],
            ),
            dmsg(
                "next-user",
                DisplayMessageType::User,
                vec![text("continue")],
            ),
        ];
        let waiting = encode_revision(&messages, None);
        assert_eq!(ids(&waiting), vec!["previous", "next-user"]);
        assert!(waiting.iter().all(|item| !item_streaming(item)));

        messages.push(dmsg(
            "next-answer",
            DisplayMessageType::Assistant,
            vec![content],
        ));
        let partial = encode_revision(&messages, Some(kind));
        assert_eq!(ids(&partial), vec!["previous", "next-user", expected_id]);
        assert_eq!(&partial[..2], &waiting);
        assert!(item_streaming(&partial[2]));

        let committed = encode_revision(&messages, None);
        assert!(committed.iter().all(|item| !item_streaming(item)));
        assert_eq!(without_streaming(partial), committed);
        assert_eq!(committed, encode(&messages));
    }
}
