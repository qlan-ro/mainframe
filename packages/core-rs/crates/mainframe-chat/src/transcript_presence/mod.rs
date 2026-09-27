//! Ported from `packages/core/src/chat/transcript-presence.ts`.
//!
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

use mainframe_adapter_api::BoxFuture;
use mainframe_types::chat::{Chat, ProcessState};
use mainframe_types::events::DaemonEvent;
use mainframe_types::transcript::TranscriptLocation;

use crate::chat_cwd::chat_cwd;

#[cfg(test)]
mod tests;

/// The narrow surface `reconcileTranscriptPresence` needs. The TS deps hold `db`,
/// `adapters`, `emitEvent` and `syncChatFields`; the adapter lookup is folded into
/// `locate_transcript` here — a `None` result covers every "cannot judge" case
/// (adapter has no layout, lookup failed), which all leave the chat unchanged.
pub trait TranscriptPresenceDeps: Send + Sync {
    /// `db.chats.update(chatId, { transcriptMissing })`.
    fn chats_update_transcript_missing(&self, chat_id: &str, missing: bool);
    /// `db.chats.update(chatId, { sessionFilePath })`.
    fn chats_update_session_file_path(&self, chat_id: &str, path: &str);
    /// `db.projects.get(projectId)?.path`.
    fn projects_get_path(&self, project_id: &str) -> Option<String>;
    /// `adapters.get(adapterId)?.locateTranscript(sessionId, projectPath, sessionFilePath)`.
    /// `None` = the location cannot be determined (no adapter / no layout / error).
    fn locate_transcript<'a>(
        &'a self,
        adapter_id: &'a str,
        session_id: &'a str,
        project_path: &'a str,
        session_file_path: Option<&'a str>,
    ) -> BoxFuture<'a, Option<TranscriptLocation>>;
    /// `syncChatFields(chatId, { transcriptMissing })` — mirror into the active cache.
    fn sync_chat_fields_transcript_missing(&self, chat_id: &str, missing: bool);
    /// `syncChatFields(chatId, { sessionFilePath })` — mirror into the active cache.
    fn sync_chat_fields_session_file_path(&self, chat_id: &str, path: &str);
    /// `emitEvent(event)`.
    fn emit_event(&self, event: DaemonEvent);
}

/// Reconcile the persisted `transcriptMissing` flag against the transcript file
/// on disk. Returns the current missing-state after reconciliation.
///
/// Skips (returns the existing flag unchanged) when:
/// - the chat has an active run — the CLI owns the file mid-session;
/// - the chat was started with no vendor persistence (rule 7) — it never wrote one;
/// - the adapter cannot determine the transcript's location.
pub async fn reconcile_transcript_presence(
    deps: &dyn TranscriptPresenceDeps,
    chat: &mut Chat,
) -> bool {
    let current = chat.transcript_missing.unwrap_or(false);

    // A live run still owns the file, and rule 7's no-persistence sessions
    // never wrote one — neither case can be reconciled against disk.
    if chat.process_state == Some(Some(ProcessState::Working)) || chat.vendor_session_ephemeral {
        return current;
    }

    // A chat that never spawned a CLI session is new, not degraded — clear any stale flag.
    if chat.claude_session_id.is_none() {
        if current {
            apply_flag(deps, chat, false);
        }
        return false;
    }

    let Some(location) = locate(deps, chat).await else {
        return current;
    };
    let missing = match location {
        TranscriptLocation::Present(path) => {
            record_path(deps, chat, path);
            false
        }
        TranscriptLocation::Missing => true,
    };
    if missing != current {
        apply_flag(deps, chat, missing);
    }
    missing
}

/// Follow a transcript the CLI just moved (the agent entered or left a worktree),
/// so the stored path is right before the next lookup needs it. Safe mid-turn,
/// unlike [`reconcile_transcript_presence`]: it only acts on a transcript it
/// found — re-pointing the path and clearing a stale missing flag — and never
/// flags one missing while the CLI may still be writing it.
pub async fn refresh_transcript_location(deps: &dyn TranscriptPresenceDeps, chat: &mut Chat) {
    if chat.vendor_session_ephemeral || chat.claude_session_id.is_none() {
        return;
    }
    let Some(TranscriptLocation::Present(path)) = locate(deps, chat).await else {
        return;
    };
    record_path(deps, chat, path);
    if chat.transcript_missing == Some(true) {
        apply_flag(deps, chat, false);
    }
}

/// The adapter's view of where `chat`'s transcript is. `None` when the chat has
/// no session or no resolvable working directory, or the adapter cannot tell.
async fn locate(deps: &dyn TranscriptPresenceDeps, chat: &Chat) -> Option<TranscriptLocation> {
    let session_id = chat.claude_session_id.as_deref()?;
    let project_path = deps.projects_get_path(&chat.project_id);
    let cwd = chat_cwd(
        chat.worktree_path.as_deref(),
        chat.scratch_path.as_deref(),
        project_path,
    )?;
    deps.locate_transcript(
        &chat.adapter_id,
        session_id,
        &cwd,
        chat.session_file_path.as_deref(),
    )
    .await
}

/// Persist and mirror a transcript path that moved. No `chat.updated`: clients
/// never read the path, and every consumer re-reads it from the row.
fn record_path(deps: &dyn TranscriptPresenceDeps, chat: &mut Chat, path: String) {
    if chat.session_file_path.as_deref() == Some(path.as_str()) {
        return;
    }
    deps.chats_update_session_file_path(&chat.id, &path);
    deps.sync_chat_fields_session_file_path(&chat.id, &path);
    chat.session_file_path = Some(path);
}

/// Persist the flipped flag, mirror it in memory, and broadcast chat.updated.
fn apply_flag(deps: &dyn TranscriptPresenceDeps, chat: &mut Chat, missing: bool) {
    deps.chats_update_transcript_missing(&chat.id, missing);
    chat.transcript_missing = Some(missing);
    deps.sync_chat_fields_transcript_missing(&chat.id, missing);
    deps.emit_event(DaemonEvent::ChatUpdated {
        chat: chat.clone(),
        reason: None,
    });
}

// PORT STATUS: src/chat/transcript-presence.ts (77 lines) — NEW module (#424)
// confidence: high
// todos: 0
// notes: `reconcileTranscriptPresence` ported; `chat` is `&mut Chat` (TS mutates the
// notes: passed object's `transcriptMissing`). The TS three "cannot judge" branches
// notes: (no `isTranscriptPresent`, predicate `null`, predicate throws) all collapse
// notes: to the deps returning `None` → return current unchanged, no emit. transcript-
// notes: presence.test.ts ported ×7 against an in-crate `TranscriptPresenceDeps` fake
// notes: (chat tests use trait fakes, not the mainframe-db repos). Rust-only: the
// notes: predicate became `locate_transcript` so a relocated transcript's path is
// notes: persisted, and `refresh_transcript_location` follows worktree-tool moves.
