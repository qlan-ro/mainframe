//! Adapter-neutral message grouping, projection, and display conversion.
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

// Crate-root re-exports of the most-used display helpers.
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
pub mod command_metadata;
pub mod decoders;
pub mod display_assistant;
pub mod display_pipeline_markers;
pub mod display_tool_groups;
pub mod display_user;
pub mod incremental;
pub mod message_grouping;
pub mod message_parsing;
pub mod parse_ask_user_question;
pub mod presentation_display;
pub mod presentation_grouping;
#[cfg(test)]
mod presentation_grouping_tests;
pub mod task_subject_backfill;
pub use decoders::ToolResultDecoders;
