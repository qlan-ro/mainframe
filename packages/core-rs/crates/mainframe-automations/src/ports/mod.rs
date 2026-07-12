//! Trait ports — every external effect the engine has goes through one of
//! these, so the engine crate never depends back on mainframe-server
//! (locked decision: ports are traits, production impls live server-side).

pub mod clock;
pub mod events;

pub use clock::{Clock, SystemClock};
pub use events::{AutomationEvent, EventSink, RunSummary, RunTriggerSummary, to_run_summary};

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T3.1-T4.1), not a TS port
// confidence: high
// todos: 0
// notes: AgentPort/Notifier/ProjectRegistry/CredentialStore land with their
//        phases (T4.3-T8).
