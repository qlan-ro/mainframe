//! Ported from `src/server/middleware/*`.

pub mod compression;

pub mod auth;

// PORT STATUS: src/server/middleware/* (auth only)
// confidence: high
// todos: 0
// notes: auth.ts is the only middleware in the TS tree. compression.rs has no
// TS counterpart — it is a Rust-side transport addition (todo #294).
