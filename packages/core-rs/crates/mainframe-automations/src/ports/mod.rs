//! Trait ports — every external effect the engine has goes through one of
//! these, so the engine crate never depends back on mainframe-server
//! (locked decision: ports are traits, production impls live server-side).

pub mod agent;
pub mod clock;
pub mod events;
pub mod notify;
pub mod projects;

pub use agent::{
    AgentHandle, AgentOutcome, AgentPort, AgentPortError, AgentRequest, WorktreeRequest,
};
pub use clock::{Clock, SystemClock};
pub use events::{
    AutomationEvent, CompletedStatus, CuratedEvent, EventSink, EventSource, InteractionSummary,
    RunSummary, RunTriggerSummary, to_interaction_summary, to_run_summary,
};
pub use notify::{Notification, NotificationLinks, Notifier, NotifyError};
pub use projects::ProjectRegistry;
