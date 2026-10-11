use super::*;

impl PartialEq for ChatSurfaceEvent {
    /// Manual, since the derive is unavailable: every variant compares its
    /// fields directly except `DisplayRevision.delta`, whose `DisplaySnapshot`
    /// handle has no `PartialEq` to borrow — compared by `full`/`len`/`changes`
    /// (the delta's actual content) instead, same as the manual `Debug` impl
    /// above reads it.
    #[expect(
        clippy::too_many_lines,
        reason = "exhaustive equality table for chat surface events"
    )]
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::TurnAccepted { chat_id: a }, Self::TurnAccepted { chat_id: b }) => a == b,
            (Self::TurnStarted { chat_id: a }, Self::TurnStarted { chat_id: b }) => a == b,
            (
                Self::TurnFinished {
                    chat_id: a,
                    stop_reason: ra,
                },
                Self::TurnFinished {
                    chat_id: b,
                    stop_reason: rb,
                },
            ) => a == b && ra == rb,
            (
                Self::DisplayRevision {
                    chat_id: a,
                    delta: da,
                    streaming: sa,
                },
                Self::DisplayRevision {
                    chat_id: b,
                    delta: db,
                    streaming: sb,
                },
            ) => {
                a == b
                    && sa == sb
                    && da.full == db.full
                    && da.len == db.len
                    && da.changes == db.changes
            }
            (
                Self::GateRaised {
                    chat_id: a,
                    request: ra,
                },
                Self::GateRaised {
                    chat_id: b,
                    request: rb,
                },
            ) => a == b && ra == rb,
            (
                Self::GateResolved {
                    chat_id: a,
                    request_id: ra,
                },
                Self::GateResolved {
                    chat_id: b,
                    request_id: rb,
                },
            ) => a == b && ra == rb,
            (
                Self::Retry {
                    chat_id: a,
                    attempt: aa,
                    reason: ra,
                },
                Self::Retry {
                    chat_id: b,
                    attempt: ab,
                    reason: rb,
                },
            ) => a == b && aa == ab && ra == rb,
            (
                Self::Compaction {
                    chat_id: a,
                    phase: pa,
                },
                Self::Compaction {
                    chat_id: b,
                    phase: pb,
                },
            ) => a == b && pa == pb,
            (Self::TranscriptCleared { chat_id: a }, Self::TranscriptCleared { chat_id: b }) => {
                a == b
            }
            (Self::Resync { chat_id: a }, Self::Resync { chat_id: b }) => a == b,
            (
                Self::QueueChanged {
                    chat_id: a,
                    refs: ra,
                },
                Self::QueueChanged {
                    chat_id: b,
                    refs: rb,
                },
            ) => a == b && ra == rb,
            (
                Self::Usage {
                    chat_id: a,
                    usage: ua,
                },
                Self::Usage {
                    chat_id: b,
                    usage: ub,
                },
            ) => a == b && ua == ub,
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
    #[expect(
        clippy::too_many_lines,
        reason = "exhaustive debug formatting table for chat surface events"
    )]
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TurnAccepted { chat_id } => f
                .debug_struct("TurnAccepted")
                .field("chat_id", chat_id)
                .finish(),
            Self::TurnStarted { chat_id } => f
                .debug_struct("TurnStarted")
                .field("chat_id", chat_id)
                .finish(),
            Self::TurnFinished {
                chat_id,
                stop_reason,
            } => f
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
            Self::GateResolved {
                chat_id,
                request_id,
            } => f
                .debug_struct("GateResolved")
                .field("chat_id", chat_id)
                .field("request_id", request_id)
                .finish(),
            Self::Retry {
                chat_id,
                attempt,
                reason,
            } => f
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
            Self::Resync { chat_id } => f.debug_struct("Resync").field("chat_id", chat_id).finish(),
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
            Self::ChatEnded { chat_id } => f
                .debug_struct("ChatEnded")
                .field("chat_id", chat_id)
                .finish(),
        }
    }
}
