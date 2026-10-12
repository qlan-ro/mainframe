//! Preserves a paragraph boundary when a hidden-category tool call is
//! dropped between two visible text contributions.
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
//! sent suffix (prefix monotonicity under streaming).

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
    pub(crate) fn mark_hidden_drop(&mut self, parent: Option<String>) {
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
pub(crate) fn paragraph_break(tail: &str, incoming: &str) -> usize {
    let trailing = tail.chars().rev().take_while(|&c| c == '\n').count();
    let leading = incoming.chars().take_while(|&c| c == '\n').count();
    2usize.saturating_sub(trailing + leading)
}

#[cfg(test)]
#[path = "hidden_boundary_tests.rs"]
mod tests;
