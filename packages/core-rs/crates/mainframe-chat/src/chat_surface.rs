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

use mainframe_types::adapter::{ContextUsage, ControlRequest};
use mainframe_types::display::DisplayMessage;

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
#[derive(Debug, Clone, PartialEq)]
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
    /// The same `DisplayMessage[]` snapshot the legacy emitter already
    /// computed for this revision (`emit_display_delta`'s `new_display`) —
    /// the canonical encoder (plan task 12) consumes this directly.
    DisplayRevision {
        chat_id: String,
        messages: Vec<DisplayMessage>,
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
    },
    Usage {
        chat_id: String,
        usage: ContextUsage,
    },
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
