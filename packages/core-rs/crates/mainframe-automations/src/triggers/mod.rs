//! When-triggers at runtime: the shared best-effort fire path, the 30 s
//! schedule sweep (derived state — no trigger_state table), and the event
//! router + webhook verification.

pub(crate) mod completion;
pub(crate) mod fire;
pub(crate) mod router;
pub(crate) mod sweep;
pub(crate) mod webhook;
pub(crate) mod webhook_ingest;

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
mod webhook_ingest_test_support;

#[cfg(test)]
mod webhook_ingest_tests;

#[cfg(test)]
mod webhook_tests;
