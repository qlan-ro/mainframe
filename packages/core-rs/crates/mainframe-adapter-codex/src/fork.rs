//! Fork resolver, version gate, and fork-point pinning for the Codex adapter
//! (todo #368 — see `docs/plans/2026-09-27-todo-368-codex-fork.md`). Mirrors
//! `mainframe_adapter_claude::fork`'s split of a pure decision (`ThreadTarget`)
//! from the async pin, but Codex's own `thread/fork` RPC replaces Claude's
//! transcript-copy mechanism: forking needs no `dest_dir` write, only the
//! parent's thread id and (optionally) its last turn id at pin time.

use mainframe_types::adapter::ForkSource;

use crate::transcript::is_codex_transcript_present;

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
/// probe, so `session.rs` gains only this one call site (todo #368; keeps
/// that already-oversized file to call sites only, per the plan).
/// `transcript_present_override` is a test seam only (`CodexSession::
/// set_transcript_present_override`) — the real probe reads
/// `~/.codex/state_5.sqlite` via `is_codex_transcript_present`, which
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
            None => is_codex_transcript_present(id, None).await.unwrap_or(false),
        },
        _ => false,
    };
    resolve_thread_target(own_id, own_transcript_present, fork_source)
}

/// Parses `major.minor.patch` and compares against [`FORK_MIN_CODEX_VERSION`].
/// A version with fewer than 3 numeric components, or a non-numeric major/minor,
/// counts as unsupported (todo #368 AC: "an unparsable version… counts as
/// unsupported").
pub(crate) fn fork_supported(version: &str) -> bool {
    let mut parts = version.split('.');
    let (Some(major), Some(minor), Some(patch)) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    let Ok(major) = major.parse::<u32>() else {
        return false;
    };
    let Ok(minor) = minor.parse::<u32>() else {
        return false;
    };
    // A trailing pre-release/build suffix (rare for `codex --version`) only
    // affects the patch component; take its leading digits.
    let patch_digits: String = patch.chars().take_while(char::is_ascii_digit).collect();
    let Ok(patch) = patch_digits.parse::<u32>() else {
        return false;
    };
    (major, minor, patch) >= FORK_MIN_CODEX_VERSION
}

/// `capabilities().fork`'s reason copy (todo #368 AC: "a version-specific
/// reason, exactly as #343's… refusal path already renders for Codex today").
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
mod tests {
    use super::*;

    fn fork_source(last_turn_id: Option<&str>) -> ForkSource {
        ForkSource {
            source_session_id: "parent-thread".to_string(),
            resume_path: None,
            last_turn_id: last_turn_id.map(str::to_string),
        }
    }

    // ---- resolve_thread_target ----

    #[test]
    fn own_id_with_no_fork_source_resumes_plainly() {
        assert_eq!(
            resolve_thread_target(Some("own-id"), false, None),
            ThreadTarget::Resume("own-id".to_string())
        );
    }

    #[test]
    fn own_id_with_fork_source_and_transcript_present_resumes_plainly() {
        let source = fork_source(Some("turn-1"));
        assert_eq!(
            resolve_thread_target(Some("own-id"), true, Some(&source)),
            ThreadTarget::Resume("own-id".to_string())
        );
    }

    #[test]
    fn no_own_id_with_fork_source_forks() {
        let source = fork_source(Some("turn-1"));
        assert_eq!(
            resolve_thread_target(None, false, Some(&source)),
            ThreadTarget::Fork {
                source_id: "parent-thread".to_string(),
                last_turn_id: Some("turn-1".to_string()),
            }
        );
    }

    #[test]
    fn own_id_with_fork_source_and_missing_transcript_falls_back_to_fork() {
        let source = fork_source(None);
        assert_eq!(
            resolve_thread_target(Some("own-id"), false, Some(&source)),
            ThreadTarget::Fork {
                source_id: "parent-thread".to_string(),
                last_turn_id: None,
            }
        );
    }

    #[test]
    fn no_own_id_and_no_fork_source_starts_fresh() {
        assert_eq!(
            resolve_thread_target(None, false, None),
            ThreadTarget::Start
        );
    }

    // ---- fork_supported ----

    #[test]
    fn fork_supported_below_at_and_above_the_floor() {
        assert!(!fork_supported("0.142.9"));
        assert!(fork_supported("0.143.0"));
        assert!(fork_supported("0.155.1"));
    }

    #[test]
    fn fork_supported_is_false_for_an_unparsable_version() {
        assert!(!fork_supported(""));
        assert!(!fork_supported("not-a-version"));
        assert!(!fork_supported("0.143"));
    }

    // ---- fork_unavailable_reason_for ----

    #[test]
    fn reason_is_none_when_version_unknown_or_supported() {
        assert_eq!(fork_unavailable_reason_for(None), None);
        assert_eq!(fork_unavailable_reason_for(Some("0.155.1")), None);
    }

    #[test]
    fn reason_names_the_floor_and_installed_version_when_below_it() {
        assert_eq!(
            fork_unavailable_reason_for(Some("0.140.0")),
            Some(
                "Forking Codex chats needs Codex CLI 0.143.0 or newer (installed: 0.140.0)"
                    .to_string()
            )
        );
    }
}
