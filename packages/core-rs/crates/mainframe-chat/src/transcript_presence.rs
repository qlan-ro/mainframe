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
/// - the adapter has no `isTranscriptPresent` predicate;
/// - presence cannot be determined (predicate returns `null` or throws).
pub async fn reconcile_transcript_presence(
    deps: &dyn TranscriptPresenceDeps,
    chat: &mut Chat,
) -> bool {
    let current = chat.transcript_missing.unwrap_or(false);

    if chat.process_state == Some(Some(ProcessState::Working)) {
        return current;
    }

    // A chat that never spawned a CLI session is new, not degraded — clear any stale flag.
    let Some(session_id) = chat.claude_session_id.clone() else {
        if current {
            apply_flag(deps, chat, false);
        }
        return false;
    };

    let Some(project_path) = deps.projects_get_path(&chat.project_id) else {
        return current;
    };
    let cwd = chat.worktree_path.clone().unwrap_or(project_path);

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct FakeDeps {
        present: Option<bool>,
        has_project: bool,
        events: Mutex<Vec<DaemonEvent>>,
        synced: Mutex<Vec<(String, bool)>>,
        updated: Mutex<Vec<(String, bool)>>,
    }
    impl FakeDeps {
        fn new(present: Option<bool>) -> Self {
            Self {
                present,
                has_project: true,
                events: Mutex::new(Vec::new()),
                synced: Mutex::new(Vec::new()),
                updated: Mutex::new(Vec::new()),
            }
        }
    }
    impl TranscriptPresenceDeps for FakeDeps {
        fn chats_update_transcript_missing(&self, chat_id: &str, missing: bool) {
            self.updated
                .lock()
                .unwrap()
                .push((chat_id.to_string(), missing));
        }
        fn projects_get_path(&self, _project_id: &str) -> Option<String> {
            self.has_project.then(|| "/project/p1".to_string())
        }
        fn is_transcript_present<'a>(
            &'a self,
            _adapter_id: &'a str,
            _session_id: &'a str,
            _project_path: &'a str,
            _session_file_path: Option<&'a str>,
        ) -> BoxFuture<'a, Option<bool>> {
            let present = self.present;
            Box::pin(async move { present })
        }
        fn sync_chat_fields_transcript_missing(&self, chat_id: &str, missing: bool) {
            self.synced
                .lock()
                .unwrap()
                .push((chat_id.to_string(), missing));
        }
        fn emit_event(&self, event: DaemonEvent) {
            self.events.lock().unwrap().push(event);
        }
    }

    fn chat_with(session_id: Option<&str>, transcript_missing: Option<bool>) -> Chat {
        let mut c = crate::test_support::test_chat("chat-1");
        c.claude_session_id = session_id.map(str::to_string);
        c.transcript_missing = transcript_missing;
        c
    }

    #[tokio::test]
    async fn sets_persists_syncs_and_emits_when_transcript_is_gone() {
        let deps = FakeDeps::new(Some(false));
        let mut chat = chat_with(Some("sess-1"), None);
        let result = reconcile_transcript_presence(&deps, &mut chat).await;

        assert!(result);
        assert_eq!(chat.transcript_missing, Some(true));
        assert_eq!(
            deps.updated.lock().unwrap().as_slice(),
            [("chat-1".to_string(), true)]
        );
        assert_eq!(
            deps.synced.lock().unwrap().as_slice(),
            [("chat-1".to_string(), true)]
        );
        assert_eq!(deps.events.lock().unwrap().len(), 1);
        match &deps.events.lock().unwrap()[0] {
            DaemonEvent::ChatUpdated { chat, .. } => {
                assert_eq!(chat.id, "chat-1");
                assert_eq!(chat.transcript_missing, Some(true));
            }
            other => panic!("expected chat.updated, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn clears_flag_when_transcript_reappears() {
        let deps = FakeDeps::new(Some(true));
        let mut chat = chat_with(Some("sess-1"), Some(true));
        let result = reconcile_transcript_presence(&deps, &mut chat).await;

        assert!(!result);
        assert_eq!(chat.transcript_missing, Some(false));
        assert_eq!(deps.events.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn idempotent_when_state_unchanged() {
        let deps = FakeDeps::new(Some(false));
        let mut chat = chat_with(Some("sess-1"), Some(true));
        let result = reconcile_transcript_presence(&deps, &mut chat).await;

        assert!(result);
        assert_eq!(deps.events.lock().unwrap().len(), 0);
        assert_eq!(deps.synced.lock().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn skips_chats_with_an_active_run() {
        let deps = FakeDeps::new(Some(false));
        let mut chat = chat_with(Some("sess-1"), None);
        chat.process_state = Some(Some(ProcessState::Working));
        let result = reconcile_transcript_presence(&deps, &mut chat).await;

        assert!(!result);
        assert_eq!(deps.events.lock().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn treats_a_sessionless_chat_as_new_and_clears_a_stale_flag() {
        let deps = FakeDeps::new(Some(false));
        let mut chat = chat_with(None, Some(true));
        let result = reconcile_transcript_presence(&deps, &mut chat).await;

        assert!(!result);
        assert_eq!(chat.transcript_missing, Some(false));
        assert_eq!(
            deps.updated.lock().unwrap().as_slice(),
            [("chat-1".to_string(), false)]
        );
    }

    #[tokio::test]
    async fn skips_adapters_without_the_predicate() {
        // A missing predicate surfaces as `None` from the deps, same as a null return.
        let deps = FakeDeps::new(None);
        let mut chat = chat_with(Some("sess-1"), None);
        let result = reconcile_transcript_presence(&deps, &mut chat).await;

        assert!(!result);
        assert_eq!(deps.events.lock().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn skips_when_presence_cannot_be_determined() {
        let deps = FakeDeps::new(None);
        let mut chat = chat_with(Some("sess-1"), Some(true));
        let result = reconcile_transcript_presence(&deps, &mut chat).await;

        assert!(result);
        assert_eq!(deps.events.lock().unwrap().len(), 0);
    }
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
