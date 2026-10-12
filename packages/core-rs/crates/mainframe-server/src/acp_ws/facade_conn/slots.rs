//! The per-session state a connection holds between frames: its claim on a
//! session's lock, its gates awaiting an answer, and the ops a resume's
//! snapshot window buffers. Split out of `facade_conn.rs` for the file
//! limit; the behaviour lives in the parent's `impl FacadeConnection`.

use std::future::Future;
use std::sync::Arc;

use mainframe_acp::encoder::EncodedItem;
use mainframe_acp::encoder::delta::EncodedDelta;
use mainframe_acp::stream::SessionStream;
use mainframe_types::adapter::ControlRequest;

/// The fresh-attach fallback a [`StreamOp::Revision`] carries alongside its
/// incremental delta: a per-container encoding of the WHOLE current snapshot,
/// computed at most once per `handle_display_revision` call no matter how many
/// attached connections or the revision log end up needing it (an unseeded
/// `SessionState`/`RevisionLog`, the fresh-`attach` case). `Arc<dyn Fn...>`
/// because `StreamOp` is `Clone` (buffered, merged) and the same handle is
/// handed to every attached connection's `SessionStream::on_revision_delta`
/// plus `RevisionLog::record_delta`.
pub(crate) type LazyFullEncoding = Arc<dyn Fn() -> Vec<Vec<EncodedItem>> + Send + Sync>;

/// A gate delivered to a connection and not yet answered, keyed by the
/// JSON-RPC id its `session/request_permission` traveled under.
#[derive(Clone)]
pub struct PendingGate {
    pub chat_id: String,
    pub request: ControlRequest,
}

/// One thing that happens to a session's stream. Applied immediately on a
/// seeded stream; buffered in arrival order while a resume's snapshot is in
/// flight, then replayed through the freshly seeded stream.
/// A gate raise carries the rpc id it was delivered under, so the drain can
/// recognize the gate the replay redelivers on its own and not hand the
/// client two live requests for one decision.
#[derive(Clone)]
pub(crate) enum StreamOp {
    /// `delta` is the per-container encoding of only the containers this
    /// revision touched — `SessionStream::on_revision_delta` applies it without
    /// re-comparing settled containers. `full` is the fresh-attach fallback
    /// above, forced only when a stream is unseeded and `delta` is incremental;
    /// the hub never forces it from a buffered op (a drained op always hits a
    /// stream `reset_session` already seeded). `cursor` is the chat's
    /// revision-log boundary once this same display revision was recorded into
    /// it — `None` for a chat with no log, or when the record was a no-op.
    /// Carried alongside the delta rather than recomputed on replay, so a
    /// buffered catch-up frame's cursor is exactly the one the live revision
    /// would have sent, never a later log state read after the fact.
    Revision {
        delta: Arc<EncodedDelta>,
        full: LazyFullEncoding,
        cursor: Option<mainframe_types::acp::extensions::RevisionCursor>,
    },
    Raw {
        payload: String,
        gate_rpc_id: Option<String>,
    },
    TurnStarted,
    TurnFinished(mainframe_types::acp::update::StopReason),
    Usage(mainframe_types::acp::update::UsageUpdate),
    Retry(mainframe_types::acp::extensions::RetryMarker),
}

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

/// A connection's per-session slot. `AwaitingSeed` covers the window a
/// `session/resume` spends awaiting its snapshot: a live revision racing that
/// await has nowhere seeded to diff against yet, so its item snapshot is
/// buffered — a later revision merges into the one already waiting
/// (`fanout.rs::buffer_op`) — instead of diffed and instead of dropped.
/// Everything else raised in the window (raw frames, turn lifecycle, usage,
/// retry markers) buffers alongside it in arrival order, or it would either
/// reach the client ahead of the replay it predates or vanish with the window.
/// `reset_session` drains the lot once the stream is seeded.
pub(crate) enum SessionSlot {
    Live(SessionStream),
    AwaitingSeed { pending: Vec<StreamOp> },
}
