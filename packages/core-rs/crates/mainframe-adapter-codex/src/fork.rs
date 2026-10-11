//! Fork resolver, version gate, and fork-point pinning for the Codex adapter.
//! Mirrors `mainframe_adapter_claude::fork`'s split of a pure decision
//! (`ThreadTarget`) from the async pin, but Codex's own `thread/fork` RPC
//! replaces Claude's transcript-copy mechanism: forking needs no `dest_dir`
//! write, only the parent's thread id and (optionally) its last turn id at pin
//! time.

use mainframe_types::adapter::ForkSource;
use mainframe_types::transcript::TranscriptLocation;

use crate::transcript::locate_codex_transcript;

/// The first Codex CLI release with `ThreadForkParams.last_turn_id` (Established
/// facts: rust-v0.143.0 has it, rust-v0.142.0 doesn't). `thread/fork` itself
/// ships earlier (rust-v0.80.0) and `forkedFromId` earlier still
/// (rust-v0.119.0), but Mainframe needs turn-level pinning (v1 AC: "fork at the
/// current end of the conversation"), so the capability gates on the newer
/// floor.
pub const FORK_MIN_CODEX_VERSION: (u32, u32, u32) = (0, 143, 0);

/// What `ensure_thread`/`load_history` should target for a spawn's first
/// message. Mirrors `mainframe_adapter_claude::fork::ResumeTarget`, but `Fork`
/// carries the source thread id (Codex forks a *thread*, not a file path) plus
/// the pinned turn cap.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ThreadTarget {
    /// Resume this session's own thread id plainly (`thread/resume`).
    Resume(String),
    /// Fork the source thread (`thread/fork`), optionally through
    /// `last_turn_id` inclusive.
    Fork {
        source_id: String,
        last_turn_id: Option<String>,
    },
    /// No resume target and no fork source; start fresh (`thread/start`).
    Start,
}

/// Decide the thread target purely from state, never from a live probe itself
/// — the caller resolves `own_transcript_present` beforehand (only when both
/// `own_id` and `fork_source` are set, the same "don't pay for the probe on a
/// regular chat" reasoning Claude's `resolve_resume` gives). Mirrors Claude's
/// arms exactly, substituting Codex's thread-id fork source for Claude's
/// transcript-path one.
pub(crate) fn resolve_thread_target(
    own_id: Option<&str>,
    own_transcript_present: bool,
    fork_source: Option<&ForkSource>,
) -> ThreadTarget {
    match (own_id, fork_source) {
        (Some(id), None) => ThreadTarget::Resume(id.to_string()),
        (Some(id), Some(_)) if own_transcript_present => ThreadTarget::Resume(id.to_string()),
        (_, Some(source)) => ThreadTarget::Fork {
            source_id: source.source_session_id.clone(),
            last_turn_id: source.last_turn_id.clone(),
        },
        (None, None) => ThreadTarget::Start,
    }
}

/// `CodexSession::ensure_thread`/`load_history`'s shared entry point: resolves
/// [`ThreadTarget`] from the session's own id, its pending fork source, and
/// whether this spawn is no-persistence — including the async own-transcript
/// probe, so `session.rs` gains only this one call site (keeping that
/// already-oversized file to call sites only).
/// `transcript_present_override` is a test seam only (`CodexSession::
/// set_transcript_present_override`) — the real probe reads
/// `~/.codex/state_5.sqlite` via `locate_codex_transcript`, which
/// integration tests cannot seed safely; `None` in production always defers to
/// the real probe.
pub(crate) async fn resolve_target(
    own_id: Option<&str>,
    fork_source: Option<&ForkSource>,
    no_persistence: bool,
    transcript_present_override: Option<bool>,
) -> ThreadTarget {
    if no_persistence {
        return ThreadTarget::Start;
    }
    let own_transcript_present = match (own_id, fork_source) {
        (Some(id), Some(_)) => match transcript_present_override {
            Some(present) => present,
            None => matches!(
                locate_codex_transcript(id, None).await,
                Some(TranscriptLocation::Present(_))
            ),
        },
        _ => false,
    };
    resolve_thread_target(own_id, own_transcript_present, fork_source)
}

/// Parses `major.minor.patch` and compares against [`FORK_MIN_CODEX_VERSION`].
/// A version with fewer than 3 numeric components, or a non-numeric major/minor,
/// counts as unsupported.
pub(crate) fn fork_supported(version: &str) -> bool {
    mainframe_adapter_api::version::CliVersion::parse_leading(version)
        .and_then(|parsed| parsed.components_u32())
        .is_some_and(|parts| parts >= FORK_MIN_CODEX_VERSION)
}

/// `capabilities().fork`'s version-specific reason copy.
pub(crate) fn fork_unavailable_reason_for(version: Option<&str>) -> Option<String> {
    let version = version?;
    if fork_supported(version) {
        return None;
    }
    Some(format!(
        "Forking Codex chats needs Codex CLI {}.{}.{} or newer (installed: {version})",
        FORK_MIN_CODEX_VERSION.0, FORK_MIN_CODEX_VERSION.1, FORK_MIN_CODEX_VERSION.2
    ))
}

#[cfg(test)]
#[path = "fork_tests.rs"]
mod tests;
