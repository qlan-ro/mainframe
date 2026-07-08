//! Ported from `src/server/*` (packages/core).
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod http;
pub mod routes;

// PORT STATUS: src/server/* (health route only; the rest is not yet ported)
// confidence: low
// todos: 1
// notes: only GET /health is wired (Task 1.3 scaffold requirement); auth
// middleware, WS upgrade, and the remaining route modules are TODO(port)
// for Phase 3.
