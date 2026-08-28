use super::*;
use mainframe_types::acp::content::ContentChunk;

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

fn chunk_text(update: &SessionUpdate) -> &str {
    let SessionUpdate::AgentMessageChunk(c) = update else {
        panic!("expected an AgentMessageChunk");
    };
    let ContentBlock::Text { text, .. } = &c.content;
    text.as_str()
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
    assert_eq!(out[0], upsert);
    assert_eq!(chunk_text(&out[1]), "bc");
}

/// Criterion 3, throttle half: over an N-revision growing message pushed
/// through the diff engine then the throttle, concatenating every emitted
/// delta reconstructs the final text, and no individual frame after the
/// first repeats the full accumulated string.
#[test]
fn coalescing_a_growing_message_never_repeats_the_full_text_and_reconstructs_it() {
    use crate::encoder::{EncodedItem, ItemRole};
    use crate::session_state::SessionState;

    let mut state = SessionState::new();
    let mut throttle = Throttle::new(50);
    let mut now = 0i64;
    let mut emitted: Vec<SessionUpdate> = Vec::new();

    let revisions = ["Look", "Looking", "Looking into", "Looking into it further"];
    for text in revisions {
        let item = EncodedItem::Message {
            id: "msg_1".to_string(),
            role: ItemRole::Agent,
            text: text.to_string(),
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
    for (i, update) in emitted.iter().enumerate() {
        match update {
            SessionUpdate::AgentMessage(upsert) => {
                let content = upsert.content.clone().flatten().unwrap_or_default();
                let mainframe_types::acp::content::ContentBlock::Text { text, .. } = &content[0];
                assert_eq!(
                    i, 0,
                    "only the very first frame may carry full content, got it at index {i}"
                );
                reconstructed.push_str(text);
            }
            SessionUpdate::AgentMessageChunk(_) => {
                let delta = chunk_text(update);
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
