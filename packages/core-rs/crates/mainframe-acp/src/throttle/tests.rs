use super::*;
use mainframe_types::acp::content::ContentChunk;
use mainframe_types::acp::extensions::RevisionCursor;

fn cursor(revision: u64) -> RevisionCursor {
    RevisionCursor {
        epoch: "ep_1".to_string(),
        revision,
    }
}

fn chunk(text: &str) -> SessionUpdate {
    SessionUpdate::AgentMessageChunk(ContentChunk {
        message_id: "msg_1".to_string(),
        content: ContentBlock::Text {
            text: text.to_string(),
            meta: None,
        },
        meta: None,
    })
}

fn image_chunk(data: &str) -> SessionUpdate {
    SessionUpdate::AgentMessageChunk(ContentChunk {
        message_id: "msg_1".to_string(),
        content: ContentBlock::Image {
            data: data.to_string(),
            mime_type: "image/png".to_string(),
            uri: None,
            meta: None,
        },
        meta: None,
    })
}

fn as_update(frame: &ThrottledFrame) -> &SessionUpdate {
    let ThrottledFrame::Update(update) = frame else {
        panic!("expected an Update frame, got {frame:?}");
    };
    update
}

fn chunk_text(frame: &ThrottledFrame) -> &str {
    let SessionUpdate::AgentMessageChunk(c) = as_update(frame) else {
        panic!("expected an AgentMessageChunk");
    };
    let ContentBlock::Text { text, .. } = &c.content else {
        panic!("expected a text chunk, got {:?}", c.content);
    };
    text.as_str()
}

fn chunk_with_meta(text: &str, meta: Option<serde_json::Value>) -> SessionUpdate {
    SessionUpdate::AgentMessageChunk(ContentChunk {
        message_id: "msg_1".to_string(),
        content: ContentBlock::Text {
            text: text.to_string(),
            meta: None,
        },
        meta,
    })
}

fn chunk_meta(frame: &ThrottledFrame) -> &Option<serde_json::Value> {
    let SessionUpdate::AgentMessageChunk(c) = as_update(frame) else {
        panic!("expected an AgentMessageChunk");
    };
    &c.meta
}

#[test]
fn the_first_push_always_flushes_immediately() {
    let mut throttle = Throttle::new(50);
    let out = throttle.push(1_000, chunk("a"));
    assert_eq!(out.len(), 1);
}

#[test]
fn a_burst_within_the_window_is_held_then_flushed_as_one_coalesced_frame() {
    let mut throttle = Throttle::new(50);
    assert_eq!(throttle.push(1_000, chunk("a")).len(), 1);

    // Still inside the 50ms window: held, not dropped.
    assert!(throttle.push(1_010, chunk("b")).is_empty());
    assert!(throttle.push(1_020, chunk("c")).is_empty());

    // Window elapses: the held burst flushes as one merged chunk.
    let out = throttle.push(1_060, chunk("d"));
    assert_eq!(out.len(), 1);
    assert_eq!(chunk_text(&out[0]), "bcd");
}

#[test]
fn non_chunk_updates_pass_through_unmerged() {
    let mut throttle = Throttle::new(50);
    assert_eq!(throttle.push(1_000, chunk("a")).len(), 1);

    let upsert = SessionUpdate::AgentMessage(mainframe_types::acp::update::MessageUpsert {
        message_id: "msg_2".to_string(),
        content: Some(Some(vec![ContentBlock::Text {
            text: "full".to_string(),
            meta: None,
        }])),
        meta: None,
    });
    assert!(throttle.push(1_010, upsert.clone()).is_empty());
    assert!(throttle.push(1_020, chunk("b")).is_empty());

    let out = throttle.push(1_060, chunk("c"));
    // The upsert stays distinct from the coalesced chunk run around it.
    assert_eq!(out.len(), 2);
    assert_eq!(out[0], ThrottledFrame::Update(upsert));
    assert_eq!(chunk_text(&out[1]), "bc");
}

/// Over an N-revision growing message pushed through the diff engine then the
/// throttle, concatenating every emitted delta reconstructs the final text, and
/// no individual frame after the first repeats the full accumulated string.
#[test]
fn coalescing_a_growing_message_never_repeats_the_full_text_and_reconstructs_it() {
    use crate::encoder::{EncodedItem, ItemRole};
    use crate::session_state::SessionState;

    let mut state = SessionState::new();
    let mut throttle = Throttle::new(50);
    let mut now = 0i64;
    let mut emitted: Vec<ThrottledFrame> = Vec::new();

    let revisions = ["Look", "Looking", "Looking into", "Looking into it further"];
    for text in revisions {
        let item = EncodedItem::Message {
            id: "msg_1".to_string(),
            role: ItemRole::Agent,
            content: vec![ContentBlock::Text {
                text: text.to_string(),
                meta: None,
            }],
            meta: None,
        };
        for update in state.diff(std::slice::from_ref(&item)) {
            emitted.extend(throttle.push(now, update));
        }
        // Past the 50ms window before the next revision, so every push in
        // this loop is due and flushes on its own — the invariant must hold
        // with or without coalescing in play.
        now += 60;
    }

    let full = revisions.last().unwrap();
    let mut reconstructed = String::new();
    for (i, frame) in emitted.iter().enumerate() {
        match as_update(frame) {
            SessionUpdate::AgentMessage(upsert) => {
                let content = upsert.content.clone().flatten().unwrap_or_default();
                let mainframe_types::acp::content::ContentBlock::Text { text, .. } = &content[0]
                else {
                    panic!("expected a text block, got {:?}", content[0]);
                };
                assert_eq!(
                    i, 0,
                    "only the very first frame may carry full content, got it at index {i}"
                );
                reconstructed.push_str(text);
            }
            SessionUpdate::AgentMessageChunk(_) => {
                let delta = chunk_text(frame);
                assert_ne!(
                    delta, *full,
                    "a chunk frame must never repeat the full accumulated text"
                );
                reconstructed.push_str(delta);
            }
            other => panic!("unexpected update kind: {other:?}"),
        }
    }
    assert_eq!(&reconstructed, full);
}

#[test]
fn an_image_chunk_never_merges_and_blocks_the_text_merge_around_it() {
    let mut throttle = Throttle::new(50);
    assert_eq!(throttle.push(1_000, chunk("a")).len(), 1);

    assert!(throttle.push(1_010, chunk("b")).is_empty());
    assert!(throttle.push(1_020, image_chunk("aGk=")).is_empty());
    assert!(throttle.push(1_030, chunk("c")).is_empty());

    let out = throttle.push(1_060, chunk("d"));
    // "b" cannot merge across the image; "c"+"d" merge behind it.
    assert_eq!(out.len(), 3);
    assert_eq!(chunk_text(&out[0]), "b");
    assert_eq!(out[1], ThrottledFrame::Update(image_chunk("aGk=")));
    assert_eq!(chunk_text(&out[2]), "cd");
}

#[test]
fn flush_drains_a_trailing_held_burst_and_is_a_noop_when_empty() {
    let mut throttle = Throttle::new(50);
    assert_eq!(throttle.push(1_000, chunk("a")).len(), 1);

    // Held inside the window; no later push arrives to flush it.
    assert!(throttle.push(1_010, chunk("b")).is_empty());
    assert!(throttle.push(1_020, chunk("c")).is_empty());

    let out = throttle.flush(1_030);
    assert_eq!(out.len(), 1);
    assert_eq!(chunk_text(&out[0]), "bc");

    // Nothing pending: flush stays silent and does not reset the window.
    assert!(throttle.flush(1_040).is_empty());
}

/// Finding 7: the earlier chunk's `_meta` must not silently win just because
/// the later one merges INTO it — the committing update's meta (or lack of
/// one) has to be what survives, or a dropped `streaming` flag would never
/// reach the client.
#[test]
fn a_merged_chunk_keeps_the_later_meta() {
    let mut throttle = Throttle::new(50);
    // The first push always flushes immediately (no prior window), so it
    // never reaches the merge path — "a" establishes the window only.
    assert_eq!(throttle.push(1_000, chunk("a")).len(), 1);

    // Still inside the window: held, not flushed yet.
    let first_meta = serde_json::json!({ "_mainframe.dev": { "streaming": true } });
    assert!(
        throttle
            .push(1_010, chunk_with_meta("b", Some(first_meta)))
            .is_empty()
    );
    let second_meta = serde_json::json!({ "_mainframe.dev": { "streaming": false } });
    assert!(
        throttle
            .push(1_020, chunk_with_meta("c", Some(second_meta.clone())))
            .is_empty()
    );

    let out = throttle.flush(1_030);
    assert_eq!(out.len(), 1, "the two held chunks merge into one frame");
    assert_eq!(chunk_text(&out[0]), "bc");
    assert_eq!(
        chunk_meta(&out[0]),
        &Some(second_meta),
        "the merged chunk carries the later (second) meta, not the first"
    );
}

/// Only the last cursor in a flushed batch survives.
#[test]
fn only_the_last_cursor_in_a_batch_survives() {
    let mut throttle = Throttle::new(50);
    assert_eq!(throttle.push(1_000, chunk("a")).len(), 1);

    assert!(throttle.push_cursor(1_010, cursor(1)).is_empty());
    assert!(throttle.push(1_020, chunk("b")).is_empty());
    assert!(throttle.push_cursor(1_030, cursor(2)).is_empty());

    let out = throttle.push(1_060, chunk("c"));
    let cursors: Vec<_> = out
        .iter()
        .filter(|f| matches!(f, ThrottledFrame::Cursor(_)))
        .collect();
    assert_eq!(cursors.len(), 1, "only the last cursor survives: {out:?}");
    assert_eq!(cursors[0], &ThrottledFrame::Cursor(cursor(2)));
}

/// A dropped cursor must not have blocked the merge chain around it — chunks
/// on either side of it still coalesce as if it were never there.
#[test]
fn chunks_on_both_sides_of_a_dropped_cursor_still_coalesce() {
    let mut throttle = Throttle::new(50);
    assert_eq!(throttle.push(1_000, chunk("a")).len(), 1);

    assert!(throttle.push(1_010, chunk("b")).is_empty());
    assert!(throttle.push_cursor(1_020, cursor(1)).is_empty());
    assert!(throttle.push(1_030, chunk("c")).is_empty());
    assert!(throttle.push_cursor(1_040, cursor(2)).is_empty());

    let out = throttle.push(1_060, chunk("d"));
    assert_eq!(
        out.len(),
        2,
        "the three chunks merge into one, plus the surviving cursor: {out:?}"
    );
    assert_eq!(chunk_text(&out[0]), "bcd");
    assert_eq!(out[1], ThrottledFrame::Cursor(cursor(2)));
}

/// The cursor rides after the content it describes (per the module doc):
/// even when it arrived mid-batch, it ends up last in the flushed frames.
#[test]
fn the_cursor_rides_after_every_content_frame_in_its_batch() {
    let mut throttle = Throttle::new(50);
    assert_eq!(throttle.push(1_000, chunk("a")).len(), 1);

    assert!(throttle.push_cursor(1_010, cursor(1)).is_empty());
    assert!(throttle.push(1_020, chunk("b")).is_empty());

    let out = throttle.push(1_060, chunk("c"));
    assert_eq!(out.len(), 2);
    assert_eq!(chunk_text(&out[0]), "bc");
    assert_eq!(out[1], ThrottledFrame::Cursor(cursor(1)));
}
