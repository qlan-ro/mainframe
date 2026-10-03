//! Incremental display projection contract (todo #376).
//!
//! A per-chat projector turns raw-cache changes plus the partial overlay into
//! a [`DisplayDelta`] that touches only the containers a mutation actually
//! affected. See `docs/plans/2026-10-03-todo-376-incremental-display-projection-plan.md`
//! for the full design; this module carries the shared contract types that
//! both `mainframe-chat` (host) and `mainframe-adapter-claude`
//! (`IncrementalProjector`) depend on.

mod delta;
mod full_rebuild;
mod raw_changes;
mod snapshot;

pub use delta::{DisplayDelta, ProjectionStats};
pub use full_rebuild::FullRebuildProjector;
pub use raw_changes::{RawChange, RawChanges};
pub use snapshot::DisplaySnapshot;

use mainframe_types::chat::ChatMessage;
use mainframe_types::display::ToolCategories;

/// Input to one [`DisplayProjector::project`] call: the full raw slice (never
/// cloned by the caller — projectors read from it directly), the drained
/// mutation journal, the live partial overlay (if any), and the categories
/// used to group tool calls.
pub struct ProjectionInput<'a> {
    pub raw: &'a [ChatMessage],
    pub changes: RawChanges,
    pub overlay: Option<&'a ChatMessage>,
    pub categories: Option<&'a ToolCategories>,
}

/// Turns raw-cache changes into a container-level [`DisplayDelta`]. One
/// instance is kept per chat, alongside its [`RawChanges`] journal.
pub trait DisplayProjector: Send {
    fn project(&mut self, input: ProjectionInput<'_>) -> DisplayDelta;
}
