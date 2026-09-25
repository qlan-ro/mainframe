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

    /// Mirrors `projects_get_path` returning `None` for the hidden
    /// `NO_PROJECT_ID` row (rule 1) — the scratch path must still resolve.
    fn without_project(mut self) -> Self {
        self.has_project = false;
        self
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

// ── rule 7: a no-persistence session never wrote a transcript ────────────
#[tokio::test]
async fn skips_a_vendor_ephemeral_chat_without_checking_presence() {
    let deps = FakeDeps::new(Some(false));
    let mut chat = chat_with(Some("sess-1"), Some(false));
    chat.vendor_session_ephemeral = true;
    let result = reconcile_transcript_presence(&deps, &mut chat).await;

    assert!(!result);
    assert_eq!(deps.events.lock().unwrap().len(), 0);
    assert_eq!(deps.updated.lock().unwrap().len(), 0);
}

// ── rule 6: the scratch cwd stands in for a project the hidden row hides ─
#[tokio::test]
async fn falls_back_to_the_scratch_path_when_the_project_cannot_be_resolved() {
    let deps = FakeDeps::new(Some(false)).without_project();
    let mut chat = chat_with(Some("sess-1"), None);
    chat.scratch_path = Some("/data/scratch/chat-1".to_string());
    let result = reconcile_transcript_presence(&deps, &mut chat).await;

    assert!(result);
    assert_eq!(chat.transcript_missing, Some(true));
}
