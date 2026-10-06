//! The `mainframe` MCP server: tools an agent in one Mainframe chat uses to
//! see and drive other chats (spec
//! `docs/specs/2026-10-06-mcp-orchestration-server.md`).
//!
//! Tier 1, port-based like `mainframe-automations`: this crate depends only on
//! `mainframe-types`; the chat manager, DB, git, and event bus are reached
//! through [`ports::OrchestrationPort`], implemented in `mainframe-server`.
//! The axum route stays thin and hands authenticated bodies to
//! [`OrchestrationService::handle`].
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod credentials;
mod dispatch;
pub mod errors;
pub mod input;
mod lifecycle;
pub mod outbox;
pub mod policy;
pub mod ports;
pub mod protocol;
mod service;
pub mod state;
mod tasks;
mod tasks_ops;
pub mod tools;
mod waiter;

#[cfg(test)]
mod test_support;
#[cfg(test)]
mod test_tasks;

pub use credentials::{Caller, CredentialRegistry};
pub use protocol::{RpcReply, is_supported_version};
pub use service::{CallCtx, OrchestrationService};
pub use state::last_assistant_text;
