//! `mainframe-display` — the adapter-agnostic display pipeline.
//!
//! Ported from the neutral `DisplayMessage` slice of `packages/core/src/messages/*`
//! (the pieces that do NOT reference Claude event / JSONL shapes; the crate map
//! §2.5 records the split — Claude-specific message files live in
//! `mainframe-adapter-claude::messages` instead).
//!
//! Task 4.1 pre-created these module files so parallel port agents never touch a
//! shared `lib.rs`. Each module is an empty skeleton pending its per-file port.
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod display_helpers;
pub mod display_pipeline;
pub mod hidden_boundary;
pub mod parse_unified_diff;
pub mod projection;
pub mod tool_categorization;
pub mod tool_grouping;
pub mod truncate_tool_content;

// `index.ts` barrel re-exports for the modules that landed on the display side.
pub use tool_categorization::{
    is_explore_tool, is_hidden_tool, is_subagent_tool, is_task_progress_tool,
};
pub use tool_grouping::{
    PartEntry, TaskProgressItem, ToolGroupItem, group_task_children, group_tool_call_parts,
};

pub mod tool_call_timing;
pub use tool_call_timing::{apply_tool_call_timing, apply_tool_call_timing_to_container};

pub use projection::{
    DisplayDelta, DisplayProjector, DisplaySnapshot, FullRebuildProjector, ProjectionInput,
    ProjectionStats, RawChange, RawChanges,
};
