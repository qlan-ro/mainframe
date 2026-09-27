//! `Adapter::pin_fork_point` for Codex (todo #368) — split out of `fork.rs` to
//! keep that file's pure resolver/version-gate logic under the 300-line
//! ceiling. Unlike Claude's snapshot-copy pin (`mainframe_adapter_claude::
//! fork::pin_fork_point`), Codex's `thread/fork` needs no on-disk write at pin
//! time: pinning only reads the parent thread and records its last turn id.

use mainframe_adapter_api::{ForkPinError, ForkPinRequest};
use mainframe_types::adapter::ForkSource;
use serde_json::json;

use crate::session::spawn_temp_app_server;
use crate::types::{ThreadReadResult, ThreadReadTurn};

/// The last turn id `thread/fork`'s `lastTurnId` can legally pin to — the
/// schema's own docstring says the referenced turn "cannot be in progress",
/// and live verification (todo #368 live acceptance, task 5, real codex-cli
/// 0.155.1) confirmed the app-server rejects an in-progress id outright
/// ("-32600 lastTurnId '<id>' identifies an in-progress turn") rather than
/// pinning past it. Skips trailing in-progress turns rather than failing the
/// whole pin — a turn still streaming when the fork button is clicked simply
/// isn't inherited, which matches "fork at the current end of the
/// conversation" for whatever end had actually settled.
fn last_completed_turn_id(turns: &[ThreadReadTurn]) -> Option<String> {
    turns
        .iter()
        .rev()
        .find(|t| t.status != "inProgress")
        .map(|t| t.id.clone())
}

/// Maps a raw `thread/read` JSON-RPC error message to a `ForkPinError`. Live
/// verification (Gate 0, codex-cli 0.155.1 — CONSUMED-SURFACE CODEX-RPC-07)
/// found `thread/read` answers an id it cannot find on disk at all with
/// "thread not loaded: <id>", distinct from CODEX-RPC-06's "no rollout found
/// for thread id" (observed from a stale `thread/resume`); both are treated as
/// "nothing to pin from" rather than a hard failure.
fn map_pin_error(message: &str) -> ForkPinError {
    let lower = message.to_lowercase();
    if lower.contains("not loaded") || lower.contains("no rollout found") {
        ForkPinError::TranscriptMissing
    } else {
        ForkPinError::Failed(message.to_string())
    }
}

/// Pin a fork's starting point (todo #368): spawn a temp app-server in the
/// parent's cwd, read the parent thread, and pin its last turn id — the point
/// `thread/fork`'s `lastTurnId` will fork through, inclusive. Writes nothing to
/// `request.dest_dir`; Codex's fork mechanism needs no on-disk snapshot (the
/// retirement/startup-sweep paths already tolerate a missing directory).
pub(crate) async fn pin_fork_point(
    request: ForkPinRequest,
    executable: &str,
    resolved_path: &str,
) -> Result<ForkSource, ForkPinError> {
    let temp = spawn_temp_app_server(
        executable,
        Some(std::path::Path::new(&request.cwd)),
        true,
        resolved_path,
    )
    .await
    .map_err(|e| ForkPinError::Failed(e.to_string()))?;

    let result = temp
        .request(
            "thread/read",
            Some(json!({ "threadId": request.source_session_id, "includeTurns": true })),
        )
        .await;
    temp.close();

    let value = result.map_err(|e| map_pin_error(&e.0))?;
    let read: ThreadReadResult =
        serde_json::from_value(value).map_err(|e| ForkPinError::Failed(e.to_string()))?;
    let last_turn_id = read
        .thread
        .turns
        .as_deref()
        .and_then(last_completed_turn_id);

    Ok(ForkSource {
        source_session_id: request.source_session_id,
        resume_path: None,
        last_turn_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(id: &str, status: &str) -> ThreadReadTurn {
        ThreadReadTurn {
            id: id.to_string(),
            status: status.to_string(),
            items: Vec::new(),
        }
    }

    // ---- last_completed_turn_id ----

    #[test]
    fn no_turns_gives_none() {
        assert_eq!(last_completed_turn_id(&[]), None);
    }

    #[test]
    fn a_trailing_completed_turn_is_picked() {
        let turns = vec![turn("t1", "completed"), turn("t2", "completed")];
        assert_eq!(last_completed_turn_id(&turns), Some("t2".to_string()));
    }

    #[test]
    fn a_trailing_in_progress_turn_is_skipped_in_favor_of_the_last_completed_one() {
        let turns = vec![turn("t1", "completed"), turn("t2", "inProgress")];
        assert_eq!(last_completed_turn_id(&turns), Some("t1".to_string()));
    }

    #[test]
    fn every_turn_in_progress_gives_none() {
        let turns = vec![turn("t1", "inProgress")];
        assert_eq!(last_completed_turn_id(&turns), None);
    }

    #[test]
    fn thread_not_loaded_maps_to_transcript_missing() {
        assert_eq!(
            map_pin_error("thread not loaded: abc-123"),
            ForkPinError::TranscriptMissing
        );
    }

    #[test]
    fn no_rollout_found_maps_to_transcript_missing() {
        assert_eq!(
            map_pin_error("no rollout found for thread id abc-123"),
            ForkPinError::TranscriptMissing
        );
    }

    #[test]
    fn an_unrelated_error_maps_to_failed() {
        assert_eq!(
            map_pin_error("boom"),
            ForkPinError::Failed("boom".to_string())
        );
    }
}
