//! When-triggers at runtime (plan Phase 8): the shared best-effort fire
//! path, the 30 s schedule sweep (derived state — no trigger_state table),
//! and the event router + webhook verification (T8.3).

pub mod completion;
pub mod fire;
pub mod router;
pub mod sweep;
pub mod webhook;
pub mod webhook_ingest;

pub use completion::CompletionEmitter;
pub use fire::TriggerFirer;
pub use router::{AgentOwnedChats, TriggerRouter, spawn_event_loop};
pub use sweep::ScheduleSweeper;
pub use webhook_ingest::{WebhookDecision, WebhookHeaders, WebhookProcessor};

#[cfg(test)]
mod router_tests;

#[cfg(test)]
mod sweep_tests;

#[cfg(test)]
mod webhook_ingest_tests;

#[cfg(test)]
mod webhook_tests;

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T8.2/T8.3), not a TS port
// confidence: high
// todos: 0
// notes: fire.rs is the shared best-effort path; webhook_ingest bypasses it
//        so the route can tell duplicates (200) from start failures (500).
