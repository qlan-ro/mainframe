//! The ACP v2 chat-facade server (todo #350): JSON-RPC framing, the
//! `initialize` handshake, and the `_mainframe.dev` extension namespace,
//! built over the vendored types in `mainframe_types::acp`. Pure logic only —
//! `mainframe-server` owns the axum socket shell (`/acp/{profile}`) this
//! crate is dispatched from, so it stays free of axum/tokio dependencies and
//! unit-testable without a socket.
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod capabilities;
pub mod connection;
pub mod rpc;

pub use capabilities::{DEFAULT_HEARTBEAT_INTERVAL_MS, mainframe_capabilities};
pub use connection::{DaemonInfo, handle_frame};
