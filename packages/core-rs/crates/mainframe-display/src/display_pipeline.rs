//! Intentionally empty: the display pipeline lives in
//! `mainframe_adapter_claude::messages::display_pipeline`.
//!
//! It orchestrates Claude-specific message grouping, task-subject backfill,
//! and the display-helper converters, all of which live in
//! `mainframe-adapter-claude`; that crate already depends on
//! `mainframe-display`, so keeping the pipeline here would form a crate cycle.
