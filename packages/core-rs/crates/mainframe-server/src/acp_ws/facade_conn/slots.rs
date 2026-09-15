//! The per-session state a connection holds between frames: its claim on a
//! session's lock, its gates awaiting an answer, and the ops a resume's
//! snapshot window buffers. Split out of `facade_conn.rs` for the file
//! limit; the behaviour lives in the parent's `impl FacadeConnection`.

use std::future::Future;

use mainframe_acp::stream::SessionStream;
use mainframe_types::adapter::ControlRequest;

/// A claim on a session's lock, taken on the socket loop and awaited from
/// the spawned task that does the work.
pub enum SessionLockWait {
    /// Uncontended: the guard was available on the spot.
    Held(tokio::sync::OwnedMutexGuard<()>),
    /// Contended: already queued behind the holder, in arrival order.
    Queued(std::pin::Pin<Box<dyn Future<Output = tokio::sync::OwnedMutexGuard<()>> + Send>>),
}

impl SessionLockWait {
    pub async fn guard(self) -> tokio::sync::OwnedMutexGuard<()> {
        match self {
            SessionLockWait::Held(guard) => guard,
            SessionLockWait::Queued(acquire) => acquire.await,
        }
    }
}

/// A gate delivered to a connection and not yet answered, keyed by the
/// JSON-RPC id its `session/request_permission` traveled under.
#[derive(Clone)]
pub struct PendingGate {
    pub chat_id: String,
    pub request: ControlRequest,
}

/// One thing that happens to a session's stream. Applied immediately on a
/// seeded stream; buffered in arrival order while a resume's snapshot is in
/// flight, then replayed through the freshly seeded stream (T5/T6, R2.9).
/// A gate raise carries the rpc id it was delivered under, so the drain can
/// recognize the gate the replay redelivers on its own and not hand the
/// client two live requests for one decision.
#[derive(Clone)]
pub(crate) enum StreamOp {
    Revision(Vec<mainframe_acp::EncodedItem>),
    Raw {
        payload: String,
        gate_rpc_id: Option<String>,
    },
    TurnStarted,
    TurnFinished(mainframe_types::acp::update::StopReason),
    Usage(mainframe_types::acp::update::UsageUpdate),
    Retry(mainframe_types::acp::extensions::RetryMarker),
}

/// A connection's per-session slot. `AwaitingSeed` covers the window a
/// `session/resume` spends awaiting its snapshot (T5, R2.9): a live revision
/// racing that await has nowhere seeded to diff against yet, so its item
/// snapshot is buffered — a later revision replaces the earlier one in
/// place, since only the latest matters — instead of diffed and instead of
/// dropped. Everything else raised in the window (raw frames, turn
/// lifecycle, usage, retry markers) buffers alongside it in arrival order,
/// or it would either reach the client ahead of the replay it predates or
/// vanish with the window. `reset_session` drains the lot once the stream is
/// seeded.
pub(crate) enum SessionSlot {
    Live(SessionStream),
    AwaitingSeed { pending: Vec<StreamOp> },
}
