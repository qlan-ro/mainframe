//! Daemon runtime foundations: config, logging, device-token auth, spawn `PATH`, and
//! wire timestamps.
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod auth;
pub mod config;
pub mod fs;
pub mod http;
#[cfg(any(test, feature = "test-support"))]
pub mod log_capture;
pub mod logging;
pub mod spawn_env;

pub use spawn_env::ResolvedPath;

pub mod sync;
