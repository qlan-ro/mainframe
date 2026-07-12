//! When-triggers at runtime (plan Phase 8): the shared best-effort fire
//! path, the 30 s schedule sweep (derived state — no trigger_state table),
//! and the event router + webhook verification (T8.3).

pub mod fire;
pub mod sweep;

pub use fire::TriggerFirer;
pub use sweep::ScheduleSweeper;

#[cfg(test)]
mod sweep_tests;

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T8.2), not a TS port
// confidence: high
// todos: 0
// notes: router/webhook land with T8.3.
