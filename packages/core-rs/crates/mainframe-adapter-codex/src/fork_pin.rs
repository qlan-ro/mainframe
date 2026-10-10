//! `Adapter::pin_fork_point` for Codex — split out of `fork.rs` to
//! keep that file's pure resolver/version-gate logic under the 300-line
//! ceiling. Unlike Claude's snapshot-copy pin (`mainframe_adapter_claude::
//! fork::pin_fork_point`), Codex's `thread/fork` needs no on-disk write at pin
//! time: pinning only reads the parent thread and records its last turn id.

use mainframe_adapter_api::{FORK_CUT_NOT_FOUND_REASON, ForkCut, ForkPinError, ForkPinRequest};
use mainframe_types::adapter::ForkSource;
use serde_json::json;

use crate::item_types::ThreadItem;
use crate::session::spawn_temp_app_server;
use crate::types::{ThreadReadResult, ThreadReadTurn};

/// The last turn id `thread/fork`'s `lastTurnId` can legally pin to — the
/// schema's own docstring says the referenced turn "cannot be in progress", and
/// live verification (real codex-cli 0.155.1) confirmed the app-server rejects
/// an in-progress id outright ("-32600 lastTurnId '<id>' identifies an
/// in-progress turn") rather than pinning past it. Skips trailing in-progress
/// turns rather than failing the whole pin — a turn still streaming when the
/// fork button is clicked simply isn't inherited, which matches "fork at the
/// current end of the conversation" for whatever end had actually settled.
fn last_completed_turn_id(turns: &[ThreadReadTurn]) -> Option<String> {
    turns
        .iter()
        .rev()
        .find(|t| t.status != "inProgress")
        .map(|t| t.id.clone())
}

/// The turn a from-message fork pins: the one right before the turn that
/// holds the chosen `userMessage`. `thread/fork`'s `lastTurnId` is inclusive,
/// so pinning the previous turn leaves the message's own turn (and everything
/// after it) out of the fork. Nothing falls back to `thread/rollback`: forked
/// threads paginate history, which rejects it.
fn turn_before_message(
    turns: &[ThreadReadTurn],
    vendor_message_id: &str,
) -> Result<String, ForkPinError> {
    let not_found = || ForkPinError::PointNotFound(FORK_CUT_NOT_FOUND_REASON.to_string());
    let index = turns
        .iter()
        .position(|turn| turn_has_user_message(turn, vendor_message_id))
        .ok_or_else(not_found)?;
    let previous = index
        .checked_sub(1)
        .and_then(|i| turns.get(i))
        .ok_or_else(|| {
            ForkPinError::PointNotFound("Nothing before this message to fork".to_string())
        })?;
    // `lastTurnId` may not name an in-progress turn (CODEX-RPC-07).
    if previous.status == "inProgress" {
        return Err(not_found());
    }
    Ok(previous.id.clone())
}

fn turn_has_user_message(turn: &ThreadReadTurn, vendor_message_id: &str) -> bool {
    turn.items
        .iter()
        .any(|item| matches!(item, ThreadItem::UserMessage(m) if m.id == vendor_message_id))
}

/// The turn to pin: the last settled one for a whole-chat fork, or the turn
/// before the cut message for a from-message fork.
fn pinned_turn_id(
    turns: Option<&[ThreadReadTurn]>,
    cut: Option<&ForkCut>,
) -> Result<Option<String>, ForkPinError> {
    match cut {
        None => Ok(turns.and_then(last_completed_turn_id)),
        Some(cut) => {
            turn_before_message(turns.unwrap_or_default(), &cut.vendor_message_id).map(Some)
        }
    }
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

/// Pin a fork's starting point: spawn a temp app-server in the
/// parent's cwd, read the parent thread, and pin its last turn id (or, with a
/// cut, the turn before the cut message's turn) — the point
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
    let last_turn_id = pinned_turn_id(read.thread.turns.as_deref(), request.cut.as_ref())?;

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
            timing: Default::default(),
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

    // ---- turn_before_message ----

    fn prompt_turn(id: &str, status: &str, message_id: &str) -> ThreadReadTurn {
        let mut t = turn(id, status);
        t.items = vec![ThreadItem::UserMessage(
            crate::item_types::UserMessageItem {
                id: message_id.to_string(),
                content: None,
                text: Some("hi".to_string()),
            },
        )];
        t
    }

    fn is_point_not_found(result: Result<String, ForkPinError>) -> bool {
        matches!(result, Err(ForkPinError::PointNotFound(_)))
    }

    #[test]
    fn the_turn_before_the_messages_turn_is_pinned() {
        let turns = vec![
            prompt_turn("t1", "completed", "m1"),
            prompt_turn("t2", "completed", "m2"),
            prompt_turn("t3", "completed", "m3"),
        ];
        assert_eq!(turn_before_message(&turns, "m3"), Ok("t2".to_string()));
        assert_eq!(turn_before_message(&turns, "m2"), Ok("t1".to_string()));
    }

    #[test]
    fn the_first_turn_is_point_not_found() {
        let turns = vec![
            prompt_turn("t1", "completed", "m1"),
            prompt_turn("t2", "completed", "m2"),
        ];
        assert!(is_point_not_found(turn_before_message(&turns, "m1")));
    }

    #[test]
    fn an_absent_message_is_point_not_found() {
        let turns = vec![prompt_turn("t1", "completed", "m1")];
        assert!(is_point_not_found(turn_before_message(&turns, "nope")));
        assert!(is_point_not_found(turn_before_message(&[], "nope")));
    }

    #[test]
    fn an_in_progress_previous_turn_is_point_not_found() {
        let turns = vec![
            prompt_turn("t1", "inProgress", "m1"),
            prompt_turn("t2", "completed", "m2"),
        ];
        assert!(is_point_not_found(turn_before_message(&turns, "m2")));
    }

    #[test]
    fn a_later_in_progress_turn_does_not_block_an_earlier_cut() {
        let turns = vec![
            prompt_turn("t1", "completed", "m1"),
            prompt_turn("t2", "completed", "m2"),
            prompt_turn("t3", "inProgress", "m3"),
        ];
        assert_eq!(turn_before_message(&turns, "m2"), Ok("t1".to_string()));
    }

    #[test]
    fn no_cut_keeps_the_last_completed_turn() {
        let turns = vec![turn("t1", "completed"), turn("t2", "inProgress")];
        assert_eq!(
            pinned_turn_id(Some(&turns), None),
            Ok(Some("t1".to_string()))
        );
    }
}
