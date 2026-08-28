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
pub mod encoder;
pub mod gate_registry;
pub mod gates;
pub mod prompt;
pub mod resume;
pub mod rpc;
pub mod session_state;
pub mod throttle;

pub use capabilities::{
    DEFAULT_HEARTBEAT_INTERVAL_MS, heartbeat_notification, mainframe_capabilities,
};
pub use connection::{DaemonInfo, handle_frame, handle_frame_with_prompt};
pub use encoder::{EncodedItem, ItemRole, encode};
pub use gate_registry::{AnswerOutcome, GateRegistry};
pub use gates::{
    GateAnswerError, build_request as build_permission_request,
    parse_answer as parse_permission_answer,
};
pub use prompt::{PromptAcceptance, PromptError, PromptPort};
pub use resume::{ReplayCursor, ResumePort, ResumeReplay, dispatch_resume};
pub use session_state::SessionState;
pub use throttle::Throttle;
