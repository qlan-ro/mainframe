use super::*;

#[test]
fn no_boundary_pending_by_default() {
    let b = HiddenBoundary::new();
    assert!(!b.pending_for(&None));
    assert!(!b.pending_for(&Some("t1".to_string())));
}

#[test]
fn marks_and_matches_the_dropped_calls_parent() {
    let mut b = HiddenBoundary::new();
    b.mark_hidden_drop(None);
    assert!(b.pending_for(&None));
    assert!(!b.pending_for(&Some("t1".to_string())));
}

#[test]
fn marks_and_matches_a_subagent_parent() {
    let mut b = HiddenBoundary::new();
    b.mark_hidden_drop(Some("t1".to_string()));
    assert!(b.pending_for(&Some("t1".to_string())));
    assert!(!b.pending_for(&None));
    assert!(!b.pending_for(&Some("t2".to_string())));
}

#[test]
fn a_second_drop_replaces_the_pending_parent() {
    let mut b = HiddenBoundary::new();
    b.mark_hidden_drop(Some("t1".to_string()));
    b.mark_hidden_drop(Some("t2".to_string()));
    assert!(b.pending_for(&Some("t2".to_string())));
    assert!(!b.pending_for(&Some("t1".to_string())));
}

#[test]
fn clear_drops_the_pending_boundary() {
    let mut b = HiddenBoundary::new();
    b.mark_hidden_drop(None);
    b.clear();
    assert!(!b.pending_for(&None));
}

#[test]
fn paragraph_break_with_no_existing_newlines_needs_two() {
    assert_eq!(paragraph_break("first", "second"), 2);
}

#[test]
fn paragraph_break_tops_up_a_single_trailing_newline() {
    assert_eq!(paragraph_break("first\n", "second"), 1);
}

#[test]
fn paragraph_break_tops_up_a_single_leading_newline() {
    assert_eq!(paragraph_break("first", "\nsecond"), 1);
}

#[test]
fn paragraph_break_is_zero_when_tail_already_ends_in_a_blank_line() {
    assert_eq!(paragraph_break("first\n\n", "second"), 0);
}

#[test]
fn paragraph_break_is_zero_when_incoming_already_starts_with_a_blank_line() {
    assert_eq!(paragraph_break("first", "\n\nsecond"), 0);
}

#[test]
fn paragraph_break_never_goes_negative_with_excess_newlines() {
    assert_eq!(paragraph_break("first\n\n\n", "second"), 0);
    assert_eq!(paragraph_break("first", "\n\n\nsecond"), 0);
}

#[test]
fn paragraph_break_splits_two_between_tail_and_incoming() {
    // One newline already on each side is enough — no `\n` needs adding.
    assert_eq!(paragraph_break("first\n", "\nsecond"), 0);
}
