//! Ported from `src/commands/*`.

pub mod registry;
pub mod wrap;

pub use registry::{find_mainframe_command, get_mainframe_commands};
pub use wrap::wrap_mainframe_command;

// PORT STATUS: src/commands/ (module barrel; no TS index file)
// confidence: high
// todos: 0
// notes: registry.ts + wrap.ts each map to a sibling module.
