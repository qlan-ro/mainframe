//! Automations v2 engine: When-triggers + linear Do-steps, executed over
//! trait ports (contract: docs/plans/2026-07-12-automations-v2-contract.md).
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod actions;
pub mod credentials;
pub mod domain;
pub mod engine;
pub mod error;
pub mod interactions;
pub mod ports;
pub mod scheduler;
pub mod store;
pub mod tokens;

#[cfg(test)]
mod credentials_tests;

#[cfg(test)]
mod interactions_tests;

#[cfg(test)]
mod scheduler_tests;

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md), not a TS port
// confidence: high
// todos: 0
// notes: domain (Phase 1), store (Phase 2), tokens (Phase 3), engine
//        interpreter (Phase 4) landed; verbs/triggers/mount follow in 5-10.
