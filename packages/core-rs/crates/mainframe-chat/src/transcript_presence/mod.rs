//! Transcript-presence reconciliation (degraded-chat detection).
//!
//! The CLI owns the transcript file (Claude `~/.claude/projects/...jsonl`,
//! Codex `~/.codex/sessions/...`); retention cleanup or manual deletion leaves
//! the Mainframe chat row behind with a dead `--resume` target. This helper
//! locates the transcript via the adapter and keeps the persisted
//! `transcript_missing` flag in sync — set when the file is gone, cleared when
//! it reappears (self-healing). It also re-points `session_file_path` when the
//! CLI has moved the file (Claude relocates it on every working-directory
//! change). Runs on history load, on the periodic external-session sweep, and
//! after a worktree tool call; idempotent, so scan/load races are harmless.

use crate::chat_manager::ChatShared;
use mainframe_types::chat::{Chat, ProcessState};
use mainframe_types::chat_patch::ChatPatch;
use mainframe_types::sync::LockExt;
use mainframe_types::transcript::TranscriptLocation;

use crate::chat_cwd::chat_cwd;

#[cfg(test)]
#[path = "../transcript_presence_tests.rs"]
mod tests;

/// Reconcile the persisted `transcriptMissing` flag against the transcript file
/// on disk. Returns the current missing-state after reconciliation.
///
/// Skips (returns the existing flag unchanged) when:
/// - the chat has an active run — the CLI owns the file mid-session;
/// - the chat was started with no vendor persistence (rule 7) — it never wrote one;
/// - the adapter cannot determine the transcript's location.
pub(crate) async fn reconcile_transcript_presence(shared: &ChatShared, chat: &mut Chat) -> bool {
    let current = chat.transcript_missing.unwrap_or(false);

    // A live run still owns the file, and rule 7's no-persistence sessions
    // never wrote one — neither case can be reconciled against disk.
    if chat.process_state == Some(Some(ProcessState::Working)) || chat.vendor_session_ephemeral {
        return current;
    }

    // A chat that never spawned a CLI session is new, not degraded — clear any stale flag.
    if chat.vendor_session_id.is_none() {
        if current {
            apply_flag(shared, chat, false);
        }
        return false;
    }

    let Some(location) = locate(shared, chat).await else {
        return current;
    };
    let missing = match location {
        TranscriptLocation::Present(path) => {
            record_path(shared, chat, path);
            false
        }
        TranscriptLocation::Missing => true,
    };
    if missing != current {
        apply_flag(shared, chat, missing);
    }
    missing
}

/// Follow a transcript the CLI just moved (the agent entered or left a worktree),
/// so the stored path is right before the next lookup needs it. Safe mid-turn,
/// unlike [`reconcile_transcript_presence`]: it only acts on a transcript it
/// found — re-pointing the path and clearing a stale missing flag — and never
/// flags one missing while the CLI may still be writing it.
pub(crate) async fn refresh_transcript_location(shared: &ChatShared, chat: &mut Chat) {
    if chat.vendor_session_ephemeral || chat.vendor_session_id.is_none() {
        return;
    }
    let Some(TranscriptLocation::Present(path)) = locate(shared, chat).await else {
        return;
    };
    record_path(shared, chat, path);
    if chat.transcript_missing == Some(true) {
        apply_flag(shared, chat, false);
    }
}

/// The adapter's view of where `chat`'s transcript is. `None` when the chat has
/// no session or no resolvable working directory, or the adapter cannot tell.
async fn locate(shared: &ChatShared, chat: &Chat) -> Option<TranscriptLocation> {
    let session_id = chat.vendor_session_id.as_deref()?;
    let project_path = shared.deps.projects_get_path(&chat.project_id);
    let cwd = chat_cwd(
        chat.worktree_path.as_deref(),
        chat.scratch_path.as_deref(),
        project_path,
    )?;
    shared
        .deps
        .locate_transcript(
            &chat.adapter_id,
            session_id,
            &cwd,
            chat.session_file_path.as_deref(),
        )
        .await
}

/// Persist and mirror a transcript path that moved. No `chat.updated`: clients
/// never read the path, and every consumer re-reads it from the row.
fn record_path(shared: &ChatShared, chat: &mut Chat, path: String) {
    if chat.session_file_path.as_deref() == Some(path.as_str()) {
        return;
    }
    storage_event!(
        shared,
        shared.deps.chats_update(
            &chat.id,
            &ChatPatch {
                session_file_path: Some(path.clone()),
                ..Default::default()
            },
        )
    );
    if let Some(cell) = shared.active(&chat.id) {
        cell.lock_recover().chat.session_file_path = Some(path.clone());
    }
    chat.session_file_path = Some(path);
}

/// Persist the flipped flag, mirror it in memory, and broadcast chat.updated.
fn apply_flag(shared: &ChatShared, chat: &mut Chat, missing: bool) {
    chat.transcript_missing = Some(missing);
    if let Some(cell) = shared.active(&chat.id) {
        cell.lock_recover().chat.transcript_missing = Some(missing);
    }
    storage_event!(
        shared,
        shared.update_and_emit(
            chat.clone(),
            &ChatPatch {
                transcript_missing: Some(missing),
                ..Default::default()
            },
        )
    );
}
