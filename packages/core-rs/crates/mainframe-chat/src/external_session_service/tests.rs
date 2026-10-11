use super::*;
use crate::test_support::{FakeDeps, test_chat};
use mainframe_types::chat::ChatStatus;
use mainframe_types::settings_kv::MemorySettings;
use std::sync::Mutex as StdMutex;

#[tokio::test]
async fn reconciles_every_non_archived_chat_with_a_cli_session_id() {
    let mut active = test_chat("with-session");
    active.claude_session_id = Some("sess-a".into());
    let mut archived = test_chat("archived");
    archived.claude_session_id = Some("sess-b".into());
    archived.status = ChatStatus::Archived;
    let deps = FakeDeps::with_chats(vec![active, archived, test_chat("draft")]);
    *deps.adapters.transcript_present.lock().unwrap() = Some(false);
    let shared = ChatShared::new(deps.clone());
    let service = ExternalSessionService::new(deps.clone(), shared);
    service.sweep_transcript_presence("p1").await;
    assert_eq!(
        *deps.adapters.locate_calls.lock().unwrap(),
        [("claude".into(), "sess-a".into())]
    );
    assert_eq!(deps.events().len(), 1);
}

#[tokio::test]
async fn unknown_transcript_location_leaves_the_chat_unchanged() {
    let mut chat = test_chat("with-session");
    chat.claude_session_id = Some("sess-a".into());
    let deps = FakeDeps::with_chats(vec![chat]);
    let shared = ChatShared::new(deps.clone());
    ExternalSessionService::new(deps.clone(), shared)
        .sweep_transcript_presence("p1")
        .await;
    assert!(deps.store.updates.lock().unwrap().is_empty());
    assert!(deps.events().is_empty());
}

// ── generate_import_title observability ─────────────────────────────────
// Each case installs a `LogCapture` guard and asserts the captured
// `(level, reason)` event plus the title-retention invariants; only the
// deps setup and the expected reason token differ between cases.

type CapturedEvents = StdMutex<Vec<(tracing::Level, Option<String>)>>;

fn assert_logged_once_and_title_untouched(
    events: &Arc<CapturedEvents>,
    expected_reason: &str,
    deps: &FakeDeps,
) {
    assert_eq!(
        crate::test_support::LogCapture::events_with_reason(events),
        vec![(tracing::Level::DEBUG, expected_reason.to_string())]
    );
    assert!(deps.store.updates.lock_recover().is_empty());
    assert!(
        !deps
            .emitter
            .events
            .lock_recover()
            .iter()
            .any(|e| matches!(e, DaemonEvent::ChatUpdated { .. }))
    );
}

#[tokio::test]
async fn import_with_title_generation_disabled_logs_and_keeps_the_title() {
    let deps = Arc::new(FakeDeps {
        settings: MemorySettings::default().with("general", "titleGeneration.disabled", "true"),
        ..Default::default()
    });
    let mut chat = test_chat("c1");
    chat.title = Some("Fallback Title".to_string());

    let (subscriber, events) = crate::test_support::LogCapture::install();
    let _guard = tracing::subscriber::set_default(subscriber);
    generate_import_title(
        deps.as_ref(),
        &ChatShared::new(deps.clone()),
        &mut chat,
        "first message",
        "claude",
    )
    .await;

    assert_logged_once_and_title_untouched(&events, "disabled_by_setting", &deps);
    assert_eq!(chat.title.as_deref(), Some("Fallback Title"));
}

#[tokio::test]
async fn import_with_no_title_logs_no_title_and_keeps_the_title() {
    let deps = Arc::new(FakeDeps::default());
    let mut chat = test_chat("c1");
    chat.title = Some("Fallback Title".to_string());

    let (subscriber, events) = crate::test_support::LogCapture::install();
    let _guard = tracing::subscriber::set_default(subscriber);
    generate_import_title(
        deps.as_ref(),
        &ChatShared::new(deps.clone()),
        &mut chat,
        "first message",
        "claude",
    )
    .await;

    assert_logged_once_and_title_untouched(&events, "no_title", &deps);
    assert_eq!(chat.title.as_deref(), Some("Fallback Title"));
}
