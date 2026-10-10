//! Automations v2 engine: When-triggers + linear Do-steps, executed over
//! trait ports. "Contract" in this crate's comments means the automations v2
//! wire contract (types, storage, routes, action table).
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

/// The `User-Agent` every outbound request from this crate carries. GitHub's
/// REST API answers 403 "Request forbidden by administrative rules" to any
/// request without one, and reqwest sends none by default. No version suffix:
/// the Rust crates are all pinned at the workspace's placeholder `0.0.0`, so
/// one would advertise a number that never moves.
pub const USER_AGENT: &str = "mainframe";

pub mod actions;
pub mod credentials;
pub mod domain;
pub mod engine;
pub mod error;
pub mod github_device;
pub mod github_http;
pub mod github_issues;
mod github_issues_types;
pub mod interactions;
pub mod ports;
pub mod scheduler;
pub mod service;
pub mod store;
pub mod tokens;
pub mod triggers;

pub use service::{
    AutomationSummary, AutomationsConfig, AutomationsEngine, AutomationsPorts, EngineError,
    StartError, WebhookState,
};

#[cfg(test)]
mod credentials_tests;

#[cfg(test)]
mod github_device_tests;

#[cfg(test)]
mod github_issues_errors_tests;

#[cfg(test)]
mod github_issues_tests;

#[cfg(test)]
mod interactions_tests;

#[cfg(test)]
mod scheduler_tests;
