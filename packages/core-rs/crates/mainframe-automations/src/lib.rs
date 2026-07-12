//! Automations v2 engine: When-triggers + linear Do-steps, executed over
//! trait ports (contract: docs/plans/2026-07-12-automations-v2-contract.md).
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod domain;
pub mod error;
pub mod ports;
pub mod store;
pub mod tokens;

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md), not a TS port
// confidence: high
// todos: 0
// notes: domain (Phase 1) + store (Phase 2) landed; engine/... follow in Phases 3-10.
