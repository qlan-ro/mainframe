//! The chat-surface observer seam (todo #350, plan task 10): turn lifecycle,
//! display revisions, gates, retry, compaction, and usage — the events the
//! legacy `DaemonEvent` stream cannot express (fact 6: no turn/retry/version
//! variants exist there). Both the legacy WS surface and the ACP facade
//! (`mainframe-acp`) can be driven from one implementation of [`ChatSurface`];
//! the legacy emit paths in `event_handler.rs`/`display_emitter.rs` are
//! untouched — this seam is called alongside them, never instead.
//!
//! Injection mirrors `ChatManager::attach_self`'s `OnceLock` pattern (plan
//! decision: constructor injection over another defaulted `ChatManagerDeps`
//! method, per the #273 silently-inherited-default bug class): a
//! `ChatManager`/`EventHandler` built with no surface attached is a no-op,
//! not a compile-time obligation on every existing deps impl.

use std::sync::Arc;

use mainframe_display::DisplayDelta;
use mainframe_types::adapter::{ContextUsage, ControlRequest};
use mainframe_types::chat::QueuedMessageRef;
use mainframe_types::display::StreamingLeafKind;

/// Compaction progress: `Started` when the CLI begins compacting, `Done`
/// when the compaction summary lands in the transcript.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompactionPhase {
    Started,
    Done,
}

/// Why a turn ended. `Error` covers both an adapter-reported failure
/// (`on_result`'s `is_error`) and the adapter process dying mid-turn
/// (`on_exit` while the turn was still working) — the edge case the plan
/// calls out explicitly.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnStopReason {
    Completed,
    Cancelled,
    Error,
}

/// One chat-surface event. `chat_id` is on every variant so a single
/// implementation can multiplex sessions without a second dispatch layer.
/// `Debug`/`PartialEq` are not derived (todo #376): `DisplayRevision`'s
/// `DisplayDelta` carries a `DisplaySnapshot` handle (an `Arc<Mutex<..>>`
/// over the projector's live container list, foreign to this crate), which
/// implements neither. See the manual `Debug` impl below; nothing in this
/// crate compares a whole `ChatSurfaceEvent` for equality.
#[derive(Clone)]
pub enum ChatSurfaceEvent {
    /// The manager accepted a prompt — immediately for a free chat, or
    /// enqueued behind an in-flight turn. Distinct from `TurnStarted`: an
    /// accepted-but-queued prompt has no turn running yet.
    TurnAccepted {
        chat_id: String,
    },
    /// The turn this prompt belongs to began running against the adapter.
    TurnStarted {
        chat_id: String,
    },
    TurnFinished {
        chat_id: String,
        stop_reason: TurnStopReason,
    },
    /// The container-level delta the chat's projector computed for this
    /// revision (todo #376) — the canonical encoder reads only
    /// `delta.changes` (`G4`); a consumer that has no baseline yet
    /// (unseeded) falls back to `delta.snapshot.materialize()`.
    /// `streaming` names the leaf kind the partial-message overlay currently
    /// backs, when `emit_display_for` finds one still open on the last
    /// container (spec Decision 39); `None` outside a live partial,
    /// including every resume replay (no overlay in a snapshot).
    DisplayRevision {
        chat_id: String,
        delta: DisplayDelta,
        streaming: Option<StreamingLeafKind>,
    },
    GateRaised {
        chat_id: String,
        request: ControlRequest,
    },
    GateResolved {
        chat_id: String,
        request_id: String,
    },
    /// The CLI's `api_error` retry (plan task 11); `reason` is the adapter's
    /// raw error text, not a categorized taxonomy (todo #350 group D scope).
    Retry {
        chat_id: String,
        attempt: i64,
        reason: Option<String>,
    },
    Compaction {
        chat_id: String,
        phase: CompactionPhase,
    },
    /// The transcript was wiped server-side (plan-mode clear-context). A
    /// facade client re-resumes to converge its accumulator.
    TranscriptCleared {
        chat_id: String,
    },
    /// The chat's cache was rebuilt from the transcript under ids an attached
    /// session may not hold (`do_load_chat`'s reload of an offloaded or
    /// cold-opened chat, or a failed resume delivery). The client re-resumes
    /// to converge its accumulator rather than diff old ids against new ones.
    Resync {
        chat_id: String,
    },
    /// The chat's queued-prompt set changed (enqueue, dequeue, cancel, or
    /// wholesale clear). Always the FULL current snapshot — never a delta —
    /// so observers cannot accumulate ordering bugs.
    QueueChanged {
        chat_id: String,
        refs: Vec<QueuedMessageRef>,
    },
    Usage {
        chat_id: String,
        usage: ContextUsage,
    },
    /// The chat was torn down — archived, ended, or removed with its project.
    /// Observers drop every per-chat bookkeeping they hold (the facade hub's
    /// gate registry and per-connection session state), which nothing else
    /// ever clears.
    ChatEnded {
        chat_id: String,
    },
}

impl PartialEq for ChatSurfaceEvent {
    /// Manual, mirroring the dropped derive (todo #376): every variant
    /// compares its fields directly except `DisplayRevision.delta`, whose
    /// `DisplaySnapshot` handle has no `PartialEq` to borrow — compared by
    /// `full`/`len`/`changes` (the delta's actual content) instead, same as
    /// the manual `Debug` impl above reads it.
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::TurnAccepted { chat_id: a }, Self::TurnAccepted { chat_id: b }) => a == b,
            (Self::TurnStarted { chat_id: a }, Self::TurnStarted { chat_id: b }) => a == b,
            (
                Self::TurnFinished { chat_id: a, stop_reason: ra },
                Self::TurnFinished { chat_id: b, stop_reason: rb },
            ) => a == b && ra == rb,
            (
                Self::DisplayRevision { chat_id: a, delta: da, streaming: sa },
                Self::DisplayRevision { chat_id: b, delta: db, streaming: sb },
            ) => {
                a == b
                    && sa == sb
                    && da.full == db.full
                    && da.len == db.len
                    && da.changes == db.changes
            }
            (
                Self::GateRaised { chat_id: a, request: ra },
                Self::GateRaised { chat_id: b, request: rb },
            ) => a == b && ra == rb,
            (
                Self::GateResolved { chat_id: a, request_id: ra },
                Self::GateResolved { chat_id: b, request_id: rb },
            ) => a == b && ra == rb,
            (
                Self::Retry { chat_id: a, attempt: aa, reason: ra },
                Self::Retry { chat_id: b, attempt: ab, reason: rb },
            ) => a == b && aa == ab && ra == rb,
            (
                Self::Compaction { chat_id: a, phase: pa },
                Self::Compaction { chat_id: b, phase: pb },
            ) => a == b && pa == pb,
            (Self::TranscriptCleared { chat_id: a }, Self::TranscriptCleared { chat_id: b }) => {
                a == b
            }
            (Self::Resync { chat_id: a }, Self::Resync { chat_id: b }) => a == b,
            (
                Self::QueueChanged { chat_id: a, refs: ra },
                Self::QueueChanged { chat_id: b, refs: rb },
            ) => a == b && ra == rb,
            (Self::Usage { chat_id: a, usage: ua }, Self::Usage { chat_id: b, usage: ub }) => {
                a == b && ua == ub
            }
            (Self::ChatEnded { chat_id: a }, Self::ChatEnded { chat_id: b }) => a == b,
            _ => false,
        }
    }
}

impl std::fmt::Debug for ChatSurfaceEvent {
    /// Every field formats directly except `DisplayRevision.delta`, whose
    /// `DisplaySnapshot` handle has no `Debug` impl to borrow (it is foreign
    /// to this crate) — printed as its own `full`/`len`/`changes`/`stats`
    /// instead of the opaque handle.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TurnAccepted { chat_id } => {
                f.debug_struct("TurnAccepted").field("chat_id", chat_id).finish()
            }
            Self::TurnStarted { chat_id } => {
                f.debug_struct("TurnStarted").field("chat_id", chat_id).finish()
            }
            Self::TurnFinished { chat_id, stop_reason } => f
                .debug_struct("TurnFinished")
                .field("chat_id", chat_id)
                .field("stop_reason", stop_reason)
                .finish(),
            Self::DisplayRevision {
                chat_id,
                delta,
                streaming,
            } => f
                .debug_struct("DisplayRevision")
                .field("chat_id", chat_id)
                .field("delta.full", &delta.full)
                .field("delta.len", &delta.len)
                .field("delta.changes", &delta.changes)
                .field("delta.stats", &delta.stats)
                .field("streaming", streaming)
                .finish(),
            Self::GateRaised { chat_id, request } => f
                .debug_struct("GateRaised")
                .field("chat_id", chat_id)
                .field("request", request)
                .finish(),
            Self::GateResolved { chat_id, request_id } => f
                .debug_struct("GateResolved")
                .field("chat_id", chat_id)
                .field("request_id", request_id)
                .finish(),
            Self::Retry { chat_id, attempt, reason } => f
                .debug_struct("Retry")
                .field("chat_id", chat_id)
                .field("attempt", attempt)
                .field("reason", reason)
                .finish(),
            Self::Compaction { chat_id, phase } => f
                .debug_struct("Compaction")
                .field("chat_id", chat_id)
                .field("phase", phase)
                .finish(),
            Self::TranscriptCleared { chat_id } => f
                .debug_struct("TranscriptCleared")
                .field("chat_id", chat_id)
                .finish(),
            Self::Resync { chat_id } => {
                f.debug_struct("Resync").field("chat_id", chat_id).finish()
            }
            Self::QueueChanged { chat_id, refs } => f
                .debug_struct("QueueChanged")
                .field("chat_id", chat_id)
                .field("refs", refs)
                .finish(),
            Self::Usage { chat_id, usage } => f
                .debug_struct("Usage")
                .field("chat_id", chat_id)
                .field("usage", usage)
                .finish(),
            Self::ChatEnded { chat_id } => {
                f.debug_struct("ChatEnded").field("chat_id", chat_id).finish()
            }
        }
    }
}

/// The observer trait itself. `Send + Sync` so it can be stored behind an
/// `Arc` and called from the session sink's stdout-reader task, same as
/// `SessionSink` (`mainframe-adapter-api::adapter` module doc).
pub trait ChatSurface: Send + Sync {
    fn on_chat_surface_event(&self, event: ChatSurfaceEvent);
}

/// Blanket no-op so `Option<Arc<dyn ChatSurface>>::None` and an attached
/// surface share one call site (`notify` below) instead of an `if let` at
/// every emit call.
pub(crate) fn notify(surface: Option<&Arc<dyn ChatSurface>>, event: ChatSurfaceEvent) {
    if let Some(surface) = surface {
        surface.on_chat_surface_event(event);
    }
}
