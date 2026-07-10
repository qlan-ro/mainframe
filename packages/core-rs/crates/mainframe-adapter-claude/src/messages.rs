//! Claude-specific slice of `packages/core/src/messages/*` (the pieces that
//! reference Claude event / JSONL shapes, per the crate map §2.5/§2.7 split).
//! The adapter-agnostic display pieces live in `mainframe-display` instead.
//!
//! `display_helpers` + `display_pipeline` are REASSIGNED here from
//! `mainframe-display` (§2.5 amendment): they import Claude-specific parsers and
//! the Claude `GroupedMessage`, so putting them in `mainframe-display` would form
//! a Cargo cycle (that crate leaves them as compiling empty modules).

pub mod display_helpers;
pub mod display_pipeline;
pub mod message_grouping;
pub mod message_parsing;
pub mod parse_ask_user_question;
pub mod read_tool_result_from_jsonl;
pub mod session_files;
pub mod task_subject_backfill;
