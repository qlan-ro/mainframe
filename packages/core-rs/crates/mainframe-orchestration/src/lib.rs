//! The `mainframe` MCP server: tools an agent in one Mainframe chat uses to
//! see and drive other chats (spec
//! `docs/specs/2026-10-06-mcp-orchestration-server.md`).
//!
//! Port-based like `mainframe-automations`: this crate sits below the chat
//! layer, on `mainframe-types` and `mainframe-runtime`; the chat manager, DB, git, and event bus are reached
//! through [`ports::OrchestrationPort`], implemented in `mainframe-server`.
//! The axum route stays thin and hands authenticated bodies to
//! [`OrchestrationService::handle`].
#![forbid(unsafe_code)]
#![cfg_attr(
    test,
    allow(
        clippy::too_many_lines,
        clippy::unwrap_used,
        clippy::expect_used,
        reason = "Test assertions and scenarios"
    )
)]

mod calls;
mod credentials;
mod delivery;
mod dispatch;
pub mod errors;
mod flush;
pub mod input;
mod lifecycle;
mod outbox;
mod outcome;
pub mod policy;
pub mod ports;
pub mod protocol;
mod service;
pub mod state;
mod system_prompt;
mod task_limits;
mod tasks;
mod tasks_ops;
pub mod tools;
mod turn_flags;
pub mod waiter;

#[cfg(test)]
mod test_fixture;
#[cfg(test)]
mod test_port;
#[cfg(test)]
mod test_support;
#[cfg(test)]
mod test_tasks;

pub use credentials::{Caller, CredentialRegistry};
pub use protocol::{RpcReply, is_supported_version};
pub use service::OrchestrationService;
pub use state::last_assistant_text;
pub use system_prompt::ORCHESTRATION_SYSTEM_PROMPT;
