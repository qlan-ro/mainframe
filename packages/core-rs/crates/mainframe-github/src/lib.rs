//! GitHub device authorization and Issues REST client shared by daemon features.
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

/// User agent for GitHub requests.
pub const USER_AGENT: &str = "mainframe";

pub mod github_device;
pub mod github_http;
pub mod github_issues;
mod github_issues_types;

#[cfg(test)]
mod github_device_tests;
#[cfg(test)]
mod github_issues_errors_tests;
#[cfg(test)]
mod github_issues_tests;
