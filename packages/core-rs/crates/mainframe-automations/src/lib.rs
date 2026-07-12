//! Automations v2 engine: When-triggers + linear Do-steps, executed over
//! trait ports (contract: docs/plans/2026-07-12-automations-v2-contract.md).
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod domain;

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md), not a TS port
// confidence: high
// todos: 0
// notes: domain (Phase 1) landed; store/engine/tokens/... follow in Phases 2-10.
