//! The per-chat mutation journal a `MessageCache` slot records into and a
//! projector drains on its next `project` call.

use mainframe_types::tool_call_timing::ToolCallTiming;

/// One recorded `MessageCache` mutation. Variants mirror the table in the
/// plan's "Journal and lifecycle" section.
#[derive(Debug, Clone, PartialEq)]
pub enum RawChange {
    /// A message was appended at the tail (`append`, `append_live`).
    Appended,
    /// An existing message at raw index `usize` was extended in place
    /// (`append_nested_live`).
    Nested(usize),
    /// A tool call's timing changed. Carries the id and its new timing so a
    /// consumer can patch in place without rescanning raw history.
    Timing(String, Option<ToolCallTiming>),
    /// A structural edit (removal or move) whose earliest touched raw index
    /// was `usize` (`remove_by_id`, `move_to_end`,
    /// `strip_queued_and_move_to_end`, `strip_all_queued`).
    Structural(usize),
}

/// The drained journal handed to [`super::DisplayProjector::project`]. The
/// slot clears its own copy before handing this over, so a dropped delta
/// never re-applies a change.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RawChanges(Vec<RawChange>);

impl RawChanges {
    pub fn new() -> Self {
        Self(Vec::new())
    }

    pub fn push(&mut self, change: RawChange) {
        self.0.push(change);
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = &RawChange> {
        self.0.iter()
    }

    /// Take every recorded entry, leaving the journal empty.
    pub fn drain(&mut self) -> Vec<RawChange> {
        std::mem::take(&mut self.0)
    }
}

impl FromIterator<RawChange> for RawChanges {
    fn from_iter<T: IntoIterator<Item = RawChange>>(iter: T) -> Self {
        Self(iter.into_iter().collect())
    }
}
