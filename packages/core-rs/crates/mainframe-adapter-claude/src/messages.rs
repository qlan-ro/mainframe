//! Transcript readers and shared display exports.
pub use mainframe_display::{
    display_helpers, display_pipeline, incremental, message_grouping, message_parsing,
    parse_ask_user_question, task_subject_backfill,
};
pub mod read_tool_result_from_jsonl;
pub mod session_files;
