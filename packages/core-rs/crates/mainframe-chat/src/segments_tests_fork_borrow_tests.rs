//! `pinned_bounds`: where each pinned segment of an unsent fork ends.

use super::*;
use crate::segments::compose::assemble;
use crate::segments::fork_borrow::pinned_bounds;

#[test]
fn each_pinned_segment_ends_at_its_last_shown_message() {
    let loaded = std::collections::HashMap::from([
        (
            "ns_c".to_string(),
            vec![
                user("c-u1", "a"),
                assistant("c-a1", "b"),
                marked_user("c-u2", "s2", "c"),
                assistant("c-a2", "d"),
            ],
        ),
        ("ns_x".to_string(), vec![marked_user("x-u1", "s1", "e")]),
    ]);
    let layout = c_x_c();
    let composed = assemble("chat_1", &layout, loaded, &name_of).messages;
    let bounds = pinned_bounds(&layout, "ns_c", &composed, "fork-time");
    let ends: Vec<(&str, Option<&str>)> = bounds
        .iter()
        .map(|b| (b.segment_id.as_str(), b.end_message_id.as_deref()))
        .collect();
    // s1 runs on ns_x, so only the two ns_c segments are bounded.
    assert_eq!(ends, [("s0", Some("c-a1")), ("s2", Some("c-a2"))]);
    assert_eq!(bounds[0].end_at.as_deref(), Some("2026-10-06T00:00:00Z"));
}

#[test]
fn a_segment_that_shows_nothing_is_bounded_by_the_fork_time() {
    let layout = c_x_c();
    let bounds = pinned_bounds(&layout, "ns_c", &[], "fork-time");
    assert!(bounds.iter().all(|b| b.end_message_id.is_none()));
    assert!(
        bounds
            .iter()
            .all(|b| b.end_at.as_deref() == Some("fork-time"))
    );
}
