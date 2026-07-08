//! Ported from `src/server/routes/*` — one module per TS route file.

pub mod health;

// PORT STATUS: src/server/routes/* (health only; the rest is not yet ported)
// confidence: low
// todos: 1
// notes: only `health.rs` exists so far; the remaining route files are
// TODO(port) for Phase 3.
