//! The ACP v2 chat-facade server: JSON-RPC framing, the
//! `initialize` handshake, and the `_mainframe.dev` extension namespace,
//! built over the vendored types in `mainframe_types::acp`. Pure logic only —
//! `mainframe-server` owns the axum socket shell (`/acp/{profile}`) this
//! crate is dispatched from, so it stays free of axum/tokio dependencies and
//! unit-testable without a socket.
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod capabilities;
pub mod connection;
mod container_index;
pub mod encoder;
pub mod gate_registry;
pub mod gates;
pub mod prompt;
pub mod replay_batch;
pub mod replay_previews;
pub mod resume;
pub mod revision_log;
pub mod rpc;
pub mod session_state;
pub mod stream;
pub mod throttle;

pub use capabilities::{
    DEFAULT_HEARTBEAT_INTERVAL_MS, client_opts_into_compressed_replay,
    client_opts_into_replay_result_previews, client_opts_into_revision_cursors,
    compaction_notification, cursor_notification, gate_resolved_notification,
    heartbeat_notification, mainframe_capabilities, queue_state_notification,
    replay_complete_notification, resync_notification, transcript_cleared_notification,
};
pub use connection::{
    DaemonInfo, DispatchOutcome, dispatch_with_prompt, handle_frame_with_prompt,
    initialize_required,
};
pub use encoder::delta::EncodedDelta;
pub use encoder::{EncodedItem, ItemRole, encode};
pub use gate_registry::{AnswerOutcome, GateRegistry};
pub use gates::{
    GateAnswerError, build_request as build_permission_request, gate_request_id,
    parse_answer as parse_permission_answer,
};
pub use prompt::{PromptAcceptance, PromptError, PromptPort};
pub use replay_batch::{REPLAY_BATCH_MAX_UPDATES, replay_batch_notifications};
pub use replay_previews::{FULL_RESULT_CONTAINERS, PREVIEW_BYTES, preview_ids, preview_item};
pub use resume::{
    ReplayCursor, ResumeOptions, ResumePort, ResumeReplay, dispatch_resume, dispatch_resume_with,
};
pub use revision_log::{RecordOutcome, ReplayPlan, RevisionLog};
pub use session_state::SessionState;
pub use stream::SessionStream;
pub use throttle::{Throttle, ThrottledFrame};
