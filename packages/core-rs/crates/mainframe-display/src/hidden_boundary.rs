//! Preserves a paragraph boundary when a hidden-category tool call is
//! dropped between two visible text contributions (todo #383).
//!
//! `group_tool_call_parts` (`tool_grouping.rs`) drops a hidden tool call with
//! no marker, so the text before and after it lands adjacent in the same
//! `PartEntry::Text` run and `push_text` (the encoder, unchanged) concatenates
//! them with no separator — two paragraphs run together. [`HiddenBoundary`]
//! tracks whether a hidden drop is still "pending" a following text, and
//! [`paragraph_break`] computes the `\n` run that restores exactly one blank
//! line without doubling a break the text already carries.
//!
//! The break is applied to the *incoming* text, never retroactively to the
//! tail already pushed, so a streamed revision only ever grows an already-
//! sent suffix (plan "Risks — Prefix monotonicity under streaming").

/// Tracks the most recent hidden-tool drop still awaiting a following text
/// push. `pending` holds the dropped call's `parent_tool_use_id` (`None` for
/// the main agent, `Some(id)` for a subagent) — `Option<Option<String>>` so
/// "no boundary pending" is distinguishable from "pending, with no parent".
#[derive(Debug, Default, Clone, PartialEq)]
pub struct HiddenBoundary {
    pending: Option<Option<String>>,
}

impl HiddenBoundary {
    pub fn new() -> Self {
        Self { pending: None }
    }

    /// A hidden tool call with `parent` was just dropped — mark (or replace)
    /// the pending boundary. Several hidden calls in a row collapse to one
    /// boundary, keyed by the latest call's parent.
    pub fn mark_hidden_drop(&mut self, parent: Option<String>) {
        self.pending = Some(parent);
    }

    /// Any push other than a hidden drop clears the boundary: a visible tool
    /// call, passthrough content, the entry an explore run pushes, or a
    /// non-empty text push (whether or not it consumed the break — see
    /// [`Self::take_break`]'s caller in `tool_grouping.rs`).
    pub fn clear(&mut self) {
        self.pending = None;
    }

    /// Whether a boundary is pending for exactly this `parent`.
    pub fn pending_for(&self, parent: &Option<String>) -> bool {
        matches!(&self.pending, Some(p) if p == parent)
    }
}

/// Number of `\n` to prepend to `incoming` so that `tail` (the last pushed
/// text's content) followed by the break and `incoming` carries exactly one
/// blank line between them — i.e. exactly two `\n` once existing trailing
/// newlines on `tail` and leading newlines on `incoming` are counted in.
/// Saturates at 0, so an existing `"\n\n"` boundary is never doubled.
pub fn paragraph_break(tail: &str, incoming: &str) -> usize {
    let trailing = tail.chars().rev().take_while(|&c| c == '\n').count();
    let leading = incoming.chars().take_while(|&c| c == '\n').count();
    2usize.saturating_sub(trailing + leading)
}

#[cfg(test)]
mod tests {
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
}
