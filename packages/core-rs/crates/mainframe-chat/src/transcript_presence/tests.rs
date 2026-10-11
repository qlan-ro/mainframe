use super::*;
use crate::test_support::FakeDeps;
use crate::types::ActiveChat;
use mainframe_types::events::DaemonEvent;
use std::sync::{Arc, Mutex};
const FOUND_AT: &str = "/home/.claude/projects/-project-p1/sess-1.jsonl";

struct Harness {
    deps: Arc<FakeDeps>,
    shared: Arc<ChatShared>,
}
impl Harness {
    fn new(present: Option<bool>) -> Self {
        Self::at(present.map(|present| {
            if present {
                TranscriptLocation::Present(FOUND_AT.to_string())
            } else {
                TranscriptLocation::Missing
            }
        }))
    }
    fn at(location: Option<TranscriptLocation>) -> Self {
        let deps = FakeDeps::arc();
        deps.set_project_path("/project/p1");
        *deps.adapters.transcript_location.lock().unwrap() = location;
        let shared = ChatShared::new(deps.clone());
        shared.active_chats.insert(
            "chat-1".into(),
            Arc::new(Mutex::new(ActiveChat::new(
                crate::test_support::test_chat("chat-1"),
                None,
            ))),
        );
        Self { deps, shared }
    }
    fn without_project(self) -> Self {
        *self.deps.paths.project_path.lock().unwrap() = None;
        self
    }
    fn updated(&self) -> Vec<(String, bool)> {
        self.deps
            .store
            .updates
            .lock()
            .unwrap()
            .iter()
            .filter_map(|(id, p)| p.transcript_missing.map(|v| (id.clone(), v)))
            .collect()
    }
    fn paths_updated(&self) -> Vec<(String, String)> {
        self.deps
            .store
            .updates
            .lock()
            .unwrap()
            .iter()
            .filter_map(|(id, p)| p.session_file_path.clone().map(|v| (id.clone(), v)))
            .collect()
    }
    fn active(&self) -> Chat {
        self.shared
            .active("chat-1")
            .unwrap()
            .lock()
            .unwrap()
            .chat
            .clone()
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
    let deps = Harness::new(Some(false));
    let mut chat = chat_with(Some("sess-1"), None);
    let result = reconcile_transcript_presence(&deps.shared, &mut chat).await;

    assert!(result);
    assert_eq!(chat.transcript_missing, Some(true));
    assert_eq!(deps.updated().as_slice(), [("chat-1".to_string(), true)]);
    assert_eq!(deps.active().transcript_missing, Some(true));
    assert_eq!(deps.deps.events().len(), 1);
    match &deps.deps.events()[0] {
        DaemonEvent::ChatUpdated { chat, .. } => {
            assert_eq!(chat.id, "chat-1");
            assert_eq!(chat.transcript_missing, Some(true));
        }
        other => panic!("expected chat.updated, got {other:?}"),
    }
}

#[tokio::test]
async fn clears_flag_when_transcript_reappears() {
    let deps = Harness::new(Some(true));
    let mut chat = chat_with(Some("sess-1"), Some(true));
    let result = reconcile_transcript_presence(&deps.shared, &mut chat).await;

    assert!(!result);
    assert_eq!(chat.transcript_missing, Some(false));
    assert_eq!(deps.deps.events().len(), 1);
}

#[tokio::test]
async fn idempotent_when_state_unchanged() {
    let deps = Harness::new(Some(false));
    let mut chat = chat_with(Some("sess-1"), Some(true));
    let result = reconcile_transcript_presence(&deps.shared, &mut chat).await;

    assert!(result);
    assert_eq!(deps.deps.events().len(), 0);
    assert_eq!(deps.active().transcript_missing, None);
}

#[tokio::test]
async fn skips_chats_with_an_active_run() {
    let deps = Harness::new(Some(false));
    let mut chat = chat_with(Some("sess-1"), None);
    chat.process_state = Some(Some(ProcessState::Working));
    let result = reconcile_transcript_presence(&deps.shared, &mut chat).await;

    assert!(!result);
    assert_eq!(deps.deps.events().len(), 0);
}

#[tokio::test]
async fn treats_a_sessionless_chat_as_new_and_clears_a_stale_flag() {
    let deps = Harness::new(Some(false));
    let mut chat = chat_with(None, Some(true));
    let result = reconcile_transcript_presence(&deps.shared, &mut chat).await;

    assert!(!result);
    assert_eq!(chat.transcript_missing, Some(false));
    assert_eq!(deps.updated().as_slice(), [("chat-1".to_string(), false)]);
}

#[tokio::test]
async fn skips_adapters_without_the_predicate() {
    // A missing predicate surfaces as `None` from the deps, same as a null return.
    let deps = Harness::new(None);
    let mut chat = chat_with(Some("sess-1"), None);
    let result = reconcile_transcript_presence(&deps.shared, &mut chat).await;

    assert!(!result);
    assert_eq!(deps.deps.events().len(), 0);
}

#[tokio::test]
async fn skips_when_presence_cannot_be_determined() {
    let deps = Harness::new(None);
    let mut chat = chat_with(Some("sess-1"), Some(true));
    let result = reconcile_transcript_presence(&deps.shared, &mut chat).await;

    assert!(result);
    assert_eq!(deps.deps.events().len(), 0);
}

// ── rule 7: a no-persistence session never wrote a transcript ────────────
#[tokio::test]
async fn skips_a_vendor_ephemeral_chat_without_checking_presence() {
    let deps = Harness::new(Some(false));
    let mut chat = chat_with(Some("sess-1"), Some(false));
    chat.vendor_session_ephemeral = true;
    let result = reconcile_transcript_presence(&deps.shared, &mut chat).await;

    assert!(!result);
    assert_eq!(deps.deps.events().len(), 0);
    assert_eq!(deps.updated().len(), 0);
}

// ── rule 6: the scratch cwd stands in for a project the hidden row hides ─
#[tokio::test]
async fn falls_back_to_the_scratch_path_when_the_project_cannot_be_resolved() {
    let deps = Harness::new(Some(false)).without_project();
    let mut chat = chat_with(Some("sess-1"), None);
    chat.scratch_path = Some("/data/scratch/chat-1".to_string());
    let result = reconcile_transcript_presence(&deps.shared, &mut chat).await;

    assert!(result);
    assert_eq!(chat.transcript_missing, Some(true));
}

// ── the CLI relocates the transcript when the session changes directory ──
const MOVED_TO: &str = "/home/.claude/projects/-project-p1--claude-worktrees-wt/sess-1.jsonl";

fn chat_stored_at(path: &str, transcript_missing: Option<bool>) -> Chat {
    let mut chat = chat_with(Some("sess-1"), transcript_missing);
    chat.session_file_path = Some(path.to_string());
    chat
}

#[tokio::test]
async fn reconcile_persists_the_path_of_a_relocated_transcript() {
    let deps = Harness::at(Some(TranscriptLocation::Present(MOVED_TO.to_string())));
    let mut chat = chat_stored_at(FOUND_AT, Some(false));
    let result = reconcile_transcript_presence(&deps.shared, &mut chat).await;

    assert!(!result);
    assert_eq!(chat.session_file_path.as_deref(), Some(MOVED_TO));
    let expected = [("chat-1".to_string(), MOVED_TO.to_string())];
    assert_eq!(deps.paths_updated().as_slice(), expected);
    assert_eq!(deps.active().session_file_path.as_deref(), Some(MOVED_TO));
    assert_eq!(deps.deps.events().len(), 0);
}

#[tokio::test]
async fn reconcile_leaves_an_unmoved_path_alone() {
    let deps = Harness::new(Some(true));
    let mut chat = chat_stored_at(FOUND_AT, Some(false));
    reconcile_transcript_presence(&deps.shared, &mut chat).await;

    assert_eq!(deps.paths_updated().len(), 0);
    assert_eq!(deps.active().session_file_path, None);
}

#[tokio::test]
async fn refresh_follows_a_move_mid_turn_and_clears_a_stale_missing_flag() {
    let deps = Harness::at(Some(TranscriptLocation::Present(MOVED_TO.to_string())));
    let mut chat = chat_stored_at(FOUND_AT, Some(true));
    chat.process_state = Some(Some(ProcessState::Working));
    refresh_transcript_location(&deps.shared, &mut chat).await;

    assert_eq!(chat.session_file_path.as_deref(), Some(MOVED_TO));
    assert_eq!(chat.transcript_missing, Some(false));
    assert_eq!(deps.updated().as_slice(), [("chat-1".to_string(), false)]);
    assert_eq!(deps.deps.events().len(), 1);
}

#[tokio::test]
async fn refresh_never_flags_a_transcript_it_cannot_find() {
    let deps = Harness::new(Some(false));
    let mut chat = chat_stored_at(FOUND_AT, Some(false));
    refresh_transcript_location(&deps.shared, &mut chat).await;

    assert_eq!(chat.transcript_missing, Some(false));
    assert_eq!(chat.session_file_path.as_deref(), Some(FOUND_AT));
    assert_eq!(deps.updated().len(), 0);
    assert_eq!(deps.paths_updated().len(), 0);
    assert_eq!(deps.deps.events().len(), 0);
}
