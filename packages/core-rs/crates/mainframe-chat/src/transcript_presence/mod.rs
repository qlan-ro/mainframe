//! Ported from `packages/core/src/chat/transcript-presence.ts`.
//!
//! Transcript-presence reconciliation (degraded-chat detection).
//!
//! The CLI owns the transcript file (Claude `~/.claude/projects/...jsonl`,
//! Codex `~/.codex/sessions/...`); retention cleanup or manual deletion leaves
//! the Mainframe chat row behind with a dead `--resume` target. This helper
//! stats the transcript via the adapter predicate and keeps the persisted
//! `transcript_missing` flag in sync — set when the file is gone, cleared when
//! it reappears (self-healing). Runs on history load and on the periodic
//! external-session sweep; idempotent, so scan/load races are harmless.

use mainframe_adapter_api::BoxFuture;
use mainframe_types::chat::{Chat, ProcessState};
use mainframe_types::events::DaemonEvent;

use crate::chat_cwd::chat_cwd;

#[cfg(test)]
mod tests;

/// The narrow surface `reconcileTranscriptPresence` needs. The TS deps hold `db`,
/// `adapters`, `emitEvent` and `syncChatFields`; the adapter's `isTranscriptPresent`
/// predicate is folded into `is_transcript_present` here — a `None` result covers
/// all three TS "cannot judge" cases (adapter lacks the predicate, predicate
/// returned `null`, or it threw), which all leave the flag unchanged.
pub trait TranscriptPresenceDeps: Send + Sync {
    /// `db.chats.update(chatId, { transcriptMissing })`.
    fn chats_update_transcript_missing(&self, chat_id: &str, missing: bool);
    /// `db.projects.get(projectId)?.path`.
    fn projects_get_path(&self, project_id: &str) -> Option<String>;
    /// `adapters.get(adapterId)?.isTranscriptPresent(sessionId, projectPath, sessionFilePath)`.
    /// `None` = presence cannot be determined (missing predicate / null / error).
    fn is_transcript_present<'a>(
        &'a self,
        adapter_id: &'a str,
        session_id: &'a str,
        project_path: &'a str,
        session_file_path: Option<&'a str>,
    ) -> BoxFuture<'a, Option<bool>>;
    /// `syncChatFields(chatId, { transcriptMissing })` — mirror into the active cache.
    fn sync_chat_fields_transcript_missing(&self, chat_id: &str, missing: bool);
    /// `emitEvent(event)`.
    fn emit_event(&self, event: DaemonEvent);
}

/// Reconcile the persisted `transcriptMissing` flag against the transcript file
/// on disk. Returns the current missing-state after reconciliation.
///
/// Skips (returns the existing flag unchanged) when:
/// - the chat has an active run — the CLI owns the file mid-session;
/// - the chat was started with no vendor persistence (rule 7) — it never wrote one;
/// - the adapter has no `isTranscriptPresent` predicate;
/// - presence cannot be determined (predicate returns `null` or throws).
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
    let Some(session_id) = chat.claude_session_id.clone() else {
        if current {
            apply_flag(deps, chat, false);
        }
        return false;
    };

    let project_path = deps.projects_get_path(&chat.project_id);
    let Some(cwd) = chat_cwd(
        chat.worktree_path.as_deref(),
        chat.scratch_path.as_deref(),
        project_path,
    ) else {
        return current;
    };

    let present = deps
        .is_transcript_present(
            &chat.adapter_id,
            &session_id,
            &cwd,
            chat.session_file_path.as_deref(),
        )
        .await;
    let Some(present) = present else {
        return current;
    };

    let missing = !present;
    if missing != current {
        apply_flag(deps, chat, missing);
    }
    missing
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
// notes: (chat tests use trait fakes, not the mainframe-db repos).
