use super::*;
use crate::test_support::{FakeDeps, test_chat};
use mainframe_types::chat::ChatStatus;
use mainframe_types::settings_kv::MemorySettings;

#[tokio::test]
async fn reconciles_every_non_archived_chat_with_a_cli_session_id() {
    let mut active = test_chat("with-session");
    active.vendor_session_id = Some("sess-a".into());
    let mut archived = test_chat("archived");
    archived.vendor_session_id = Some("sess-b".into());
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
    chat.vendor_session_id = Some("sess-a".into());
    let deps = FakeDeps::with_chats(vec![chat]);
    let shared = ChatShared::new(deps.clone());
    ExternalSessionService::new(deps.clone(), shared)
        .sweep_transcript_presence("p1")
        .await;
    assert!(deps.store.updates.lock().unwrap().is_empty());
    assert!(deps.events().is_empty());
}

fn assert_title_untouched(deps: &FakeDeps) {
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

    generate_import_title(
        deps.as_ref(),
        &ChatShared::new(deps.clone()),
        &mut chat,
        "first message",
        "claude",
    )
    .await;

    assert_title_untouched(&deps);
    assert!(
        deps.adapters
            .generate_title_calls
            .lock()
            .unwrap()
            .is_empty()
    );
    assert_eq!(chat.title.as_deref(), Some("Fallback Title"));
}

#[tokio::test]
async fn import_with_no_title_logs_no_title_and_keeps_the_title() {
    let deps = Arc::new(FakeDeps::default());
    let mut chat = test_chat("c1");
    chat.title = Some("Fallback Title".to_string());

    generate_import_title(
        deps.as_ref(),
        &ChatShared::new(deps.clone()),
        &mut chat,
        "first message",
        "claude",
    )
    .await;

    assert_title_untouched(&deps);
    assert_eq!(
        *deps.adapters.generate_title_calls.lock().unwrap(),
        ["first message"]
    );
    assert_eq!(chat.title.as_deref(), Some("Fallback Title"));
}

#[tokio::test]
async fn imported_creation_and_generated_title_share_enrichment() {
    let deps = FakeDeps::arc();
    *deps.adapters.generated_title.lock().unwrap() = Some("Generated title".into());
    let shared = ChatShared::new(deps.clone());
    let service = ExternalSessionService::new(deps.clone(), shared);
    service
        .import_session("p1", "native", "claude", Some("hello"), None, None)
        .await
        .unwrap();
    mainframe_runtime::test_support::poll_until(
        std::time::Duration::from_secs(1),
        std::time::Duration::from_millis(5),
        async || !(deps.events().len() < 2),
    )
    .await
    .unwrap();
    let wire = serde_json::to_value(deps.events()).unwrap();
    assert_eq!(wire[0]["type"], "chat.created");
    assert_eq!(wire[1]["type"], "chat.updated");
    for field in [
        "displayStatus",
        "isRunning",
        "worktreeMissing",
        "directoryMissing",
    ] {
        assert!(!wire[0]["chat"][field].is_null());
        assert_eq!(wire[0]["chat"][field], wire[1]["chat"][field]);
    }
}
