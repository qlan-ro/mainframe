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
pub mod parse_unified_diff;
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

// PORT STATUS: src/messages/index.ts (33 lines) + display-slice module decls
// confidence: high
// todos: 0
// notes: index.ts re-exports collapse here; groupMessages/prepareMessagesForClient/
// notes: message-parsing exports belong to mainframe-adapter-claude, not re-exported
// notes: here. tool_categorization, tool_grouping, truncate_tool_content,
// notes: parse_unified_diff are fully ported + tested (all four self-contained on
// notes: mainframe-types). display_helpers + display_pipeline REMAIN SKELETON —
// notes: BLOCKER: both import Claude-specific parsers (message_parsing,
// notes: message_grouping, parse_ask_user_question, task_subject_backfill) which the
// notes: crate map §2.7 assigns to mainframe-adapter-claude, and adapter-claude
// notes: already depends on mainframe-display (Cargo). Porting them here forms a
// notes: crate cycle. Per the §2.5 "references Claude shapes → adapter-claude" test
// notes: they should be REASSIGNED to mainframe-adapter-claude (carrying
// notes: apply-tool-grouping-characterization + display-helpers-* + tool-grouping/
// notes: display-pipeline tests with them). Left as compiling empty modules.
