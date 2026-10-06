//! Provider segments: one chat, many provider-native sessions. History
//! composition (`compose`, `partition`), the divider message (`divider`),
//! switch planning and refusals (`switch_plan`, `switch_rules`), the fork
//! row plan the fork features use (`fork_plan`), and an unsent fork's switch
//! (`fork_borrow`).

pub mod compose;
pub mod divider;
pub mod fork_borrow;
pub mod fork_plan;
pub mod partition;
pub mod switch_plan;
pub mod switch_rules;

#[cfg(test)]
mod tests;

use mainframe_types::segment::{
    HandoffRecord, HandoffStatus, SegmentLayout, SegmentResultDelta, SwitchCommit,
};

/// The segment repository as the chat crate sees it. The daemon implements it
/// over `mainframe-db`; a deps impl without one (`ChatManagerDeps::
/// segment_store` → `None`) runs every chat as a single segment, exactly as
/// before segments existed.
pub trait SegmentStore: Send + Sync {
    /// Segments in ordinal order, their native rows, and live handoffs.
    fn layout(&self, chat_id: &str) -> Option<SegmentLayout>;
    /// Applies a planned switch in one transaction (mirror included).
    fn commit_switch(&self, commit: &SwitchCommit) -> Result<SegmentLayout, String>;
    /// Moves the active segment onto a fresh native row (delta fallback).
    fn replace_active_native(&self, chat_id: &str) -> Result<SegmentLayout, String>;
    /// Supersedes older pending rows, inserts `record`, stamps the marker.
    fn insert_pending_handoff(
        &self,
        record: &HandoffRecord,
        start_marker: &str,
    ) -> Result<(), String>;
    /// Returns whether the row changed.
    fn set_handoff_status(&self, handoff_id: &str, status: HandoffStatus) -> bool;
    /// Adds one turn's deltas to the active segment.
    fn add_result(&self, chat_id: &str, delta: &SegmentResultDelta);
    /// Whether any owned native row has a provider id.
    fn has_native_id(&self, chat_id: &str) -> bool;
    /// Records a relocated transcript path on one native row.
    fn set_session_file_path(&self, native_ref: &str, path: &str);
}
