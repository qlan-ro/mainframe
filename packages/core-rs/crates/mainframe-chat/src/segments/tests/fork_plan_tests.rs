//! `fork_plan` and `switch_before`: the segment helpers the fork features use.

use mainframe_types::segment::SegmentKind;

use super::*;
use crate::segments::compose::assemble;
use crate::segments::fork_plan::{ForkPoint, ForkSegmentRole, fork_plan, switch_before};

fn point(segment: &str, message: Option<&str>) -> ForkPoint {
    ForkPoint {
        segment_id: segment.into(),
        message_id: message.map(str::to_string),
    }
}

#[test]
fn a_cut_in_the_latest_segment_pins_its_native_and_borrows_the_rest() {
    let mut layout = c_x_c();
    layout.segments[1].last_message_id = Some("x-a1".into());
    let plan = fork_plan(&layout, &point("s2", Some("c-u2")), true).unwrap();
    let roles: Vec<&ForkSegmentRole> = plan.segments.iter().map(|s| &s.role).collect();
    // s0 and s2 share ns_c: both ride the pinned fork; s1 (Codex) is borrowed.
    assert_eq!(roles[0], &ForkSegmentRole::Pinned);
    assert_eq!(
        roles[1],
        &ForkSegmentRole::Borrowed {
            end_message_id: Some("x-a1".into()),
            end_at: layout.segments[1].closed_at.clone(),
        }
    );
    assert_eq!(roles[2], &ForkSegmentRole::Pinned);
    assert!(!plan.pending_active);
}

#[test]
fn a_cut_in_an_earlier_segment_drops_the_later_ones() {
    let plan = fork_plan(&c_x_c(), &point("s1", Some("x-a1")), true).unwrap();
    assert_eq!(plan.segments.len(), 2);
    assert_eq!(plan.segments[1].role, ForkSegmentRole::Pinned);
}

#[test]
fn an_unpinnable_adapter_borrows_the_cut_segment_and_starts_pending() {
    let plan = fork_plan(&c_x_c(), &point("s2", Some("c-u2")), false).unwrap();
    assert!(plan.pending_active);
    assert_eq!(
        plan.segments[2].role,
        ForkSegmentRole::Borrowed {
            end_message_id: Some("c-u2".into()),
            end_at: None
        }
    );
}

#[test]
fn a_whole_chat_fork_of_a_pending_switch_borrows_everything_before_it() {
    let mut layout = c_x_c();
    layout.segments.truncate(2);
    layout.segments[1].closed_at = None;
    layout.natives[1].native_session_id = None;
    layout.handoffs.clear();
    let plan = fork_plan(&layout, &point("s1", None), true).unwrap();
    assert!(plan.pending_active);
    assert_eq!(plan.segments.len(), 1);
    assert!(matches!(
        plan.segments[0].role,
        ForkSegmentRole::Borrowed { .. }
    ));
    assert_eq!(plan.segments[0].kind, SegmentKind::Initial);
}

#[test]
fn switch_before_names_the_switch_a_message_predates() {
    let loaded = std::collections::HashMap::from([
        (
            "ns_c".to_string(),
            vec![user("c-u1", "a"), marked_user("c-u2", "s2", "b")],
        ),
        ("ns_x".to_string(), vec![marked_user("x-u1", "s1", "c")]),
    ]);
    let composed = assemble("chat_1", &c_x_c(), loaded, &name_of).messages;
    let marker = switch_before(&composed, "x-u1").unwrap();
    assert_eq!(marker.to_adapter_name, "Claude");
    assert!(switch_before(&composed, "c-u2").is_none());
    assert!(switch_before(&composed, "missing").is_none());
}
