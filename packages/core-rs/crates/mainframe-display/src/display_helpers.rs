//! Intentionally empty: the display helpers live in
//! `mainframe_adapter_claude::messages::display_helpers`.
//!
//! They call Claude-specific parsers (message parsing, message grouping,
//! AskUserQuestion result parsing) that live in `mainframe-adapter-claude`,
//! which already depends on `mainframe-display`, so keeping them here would
//! form a crate cycle. The adapter-agnostic pieces they use (tool_grouping,
//! tool_categorization, truncate_tool_content) live in this crate.
