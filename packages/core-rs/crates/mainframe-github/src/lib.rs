//! GitHub clients shared by daemon features: the GitHub App device flow and
//! the Issues REST client.
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

pub mod device;
pub mod issues;
pub mod rest;

/// User agent for GitHub requests. The API refuses requests without one.
pub const USER_AGENT: &str = "mainframe";
