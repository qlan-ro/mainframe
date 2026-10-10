//! Claude-specific slice of the message pipeline (the pieces that reference
//! Claude event / JSONL shapes). The adapter-agnostic display pieces live in
//! `mainframe-display` instead.
//!
//! `display_helpers` + `display_pipeline` live here rather than in
//! `mainframe-display`: they import Claude-specific parsers and the Claude
//! `GroupedMessage`, so putting them in `mainframe-display` would form a Cargo
//! cycle (that crate leaves them as compiling empty modules).

pub mod display_helpers;
pub mod display_pipeline;
pub mod incremental;
pub mod message_grouping;
pub mod message_parsing;
pub mod parse_ask_user_question;
pub mod read_tool_result_from_jsonl;
pub mod session_files;
pub mod task_subject_backfill;

mod command_metadata;

mod display_assistant;
mod display_tool_groups;
mod display_user;
mod presentation_display;
mod presentation_grouping;
#[cfg(test)]
mod presentation_grouping_tests;

mod display_pipeline_markers;
