//! `encode_containers` (todo #376, plan G2 task 1): flattening it must equal
//! `encode_revision` on the existing fixtures, including streaming on the
//! last non-queued container and queued containers dropped as an empty list.
//! Shares fixture builders with `tests.rs` via `use super::*`.

use mainframe_types::display::{DisplayMessageType, StreamingLeafKind, ToolCategory};

use super::*;

#[test]
fn flattened_containers_equal_encode_revision_without_streaming() {
    let messages = vec![
        dmsg("dmsg_1", DisplayMessageType::User, vec![text("hi")]),
        dmsg(
            "dmsg_2",
            DisplayMessageType::Assistant,
            vec![
                thinking("hmm"),
                text("done"),
                tool_call("toolu_1", "Read", ToolCategory::Explore, Some("x")),
            ],
        ),
    ];

    let flattened: Vec<EncodedItem> = encode_containers(&messages, None)
        .into_iter()
        .flatten()
        .collect();
    assert_eq!(flattened, encode_revision(&messages, None));
}

#[test]
fn flattened_containers_equal_encode_revision_with_streaming() {
    let messages = vec![dmsg(
        "dmsg_seg",
        DisplayMessageType::Assistant,
        vec![
            text("A"),
            tool_call("toolu_1", "Read", ToolCategory::Explore, None),
            text("B"),
        ],
    )];

    let flattened: Vec<EncodedItem> = encode_containers(&messages, Some(StreamingLeafKind::Text))
        .into_iter()
        .flatten()
        .collect();
    assert_eq!(
        flattened,
        encode_revision(&messages, Some(StreamingLeafKind::Text))
    );
}

#[test]
fn queued_containers_encode_to_an_empty_list() {
    use std::collections::HashMap;
    let mut queued = dmsg("q1", DisplayMessageType::User, vec![text("queued turn")]);
    queued.metadata = Some(HashMap::from([("queued".to_string(), json!(true))]));
    let messages = vec![
        dmsg("u1", DisplayMessageType::User, vec![text("hi")]),
        queued,
        dmsg("a1", DisplayMessageType::Assistant, vec![text("hello")]),
    ];

    let per_container = encode_containers(&messages, None);
    assert_eq!(per_container.len(), 3);
    assert!(!per_container[0].is_empty());
    assert!(
        per_container[1].is_empty(),
        "the queued container encodes nothing"
    );
    assert!(!per_container[2].is_empty());

    let flattened: Vec<EncodedItem> = per_container.into_iter().flatten().collect();
    assert_eq!(flattened, encode_revision(&messages, None));
}

#[test]
fn streaming_lands_on_the_last_non_queued_container() {
    use std::collections::HashMap;
    let mut queued = dmsg("q2", DisplayMessageType::User, vec![text("queued turn")]);
    queued.metadata = Some(HashMap::from([("queued".to_string(), json!(true))]));
    let messages = vec![
        dmsg("a1", DisplayMessageType::Assistant, vec![text("hello")]),
        queued,
    ];

    let per_container = encode_containers(&messages, Some(StreamingLeafKind::Text));
    let EncodedItem::Message { meta, .. } = &per_container[0][0] else {
        panic!("expected a message item");
    };
    let streaming = meta
        .as_ref()
        .and_then(|v| v.get(MAINFRAME_META_NAMESPACE))
        .and_then(|ns| ns.get("streaming"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    assert!(streaming, "the last non-queued container carries streaming");
}

#[test]
fn encode_container_matches_the_single_message_encode() {
    let message = dmsg("dmsg_c", DisplayMessageType::User, vec![text("hi")]);
    assert_eq!(encode_container(&message, None), encode(&[message]));
}
