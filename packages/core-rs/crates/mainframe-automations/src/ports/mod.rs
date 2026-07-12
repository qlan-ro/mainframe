//! Trait ports — every external effect the engine has goes through one of
//! these, so the engine crate never depends back on mainframe-server
//! (locked decision: ports are traits, production impls live server-side).

pub mod clock;

pub use clock::{Clock, SystemClock};

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T3.1), not a TS port
// confidence: high
// todos: 0
// notes: AgentPort/Notifier/EventSink/ProjectRegistry/CredentialStore land
//        with their phases (T4-T8).
