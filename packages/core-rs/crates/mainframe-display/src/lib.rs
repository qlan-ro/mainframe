//! Adapter-neutral message grouping, projection, and display conversion.
#![forbid(unsafe_code)]
#![cfg_attr(
    test,
    allow(
        clippy::too_many_lines,
        clippy::unwrap_used,
        clippy::expect_used,
        reason = "Test assertions and scenarios"
    )
)]

pub mod decoders;
pub mod display_helpers;
pub mod display_pipeline;
pub mod incremental;
pub mod message_grouping;
pub mod parse_unified_diff;
pub mod truncate_tool_content;

mod display_assistant;
#[cfg(test)]
mod display_grouping_results_tests;
mod display_pipeline_markers;
mod display_tool_groups;
mod display_user;
mod hidden_boundary;
mod message_parsing;
mod parse_ask_user_question;
mod presentation_display;
mod presentation_grouping;
#[cfg(test)]
mod presentation_grouping_tests;
mod projection;
mod task_subject_backfill;
mod tool_call_timing;
mod tool_categorization;
mod tool_grouping;
mod turn_boundary;

pub use decoders::{ParsedCommand, ToolResultDecoders};
pub use projection::{
    DisplayDelta, DisplayProjector, DisplaySnapshot, FullRebuildProjector, ProjectionInput,
    ProjectionStats, RawChange, RawChanges,
};
