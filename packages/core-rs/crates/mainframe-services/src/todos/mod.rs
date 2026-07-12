//! Ported from `src/todos/normalize.ts`.

pub mod normalize;

pub use normalize::{TaskV2Event, TodoSource, normalize_todos};

// PORT STATUS: src/todos/ (module barrel; only normalize.ts is under it here)
// confidence: high
// todos: 0
// notes: todos/index.ts (the builtin plugin) is NOT in this crate (§2.9,
// mainframe-plugins); only normalize.ts lands here.
