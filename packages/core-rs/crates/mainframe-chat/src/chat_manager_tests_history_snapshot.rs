//! The history snapshot cache end to end through a real `ChatManager`
//! (`history_cache.rs` has the unit tests; this proves `get_messages`'s cold
//! path consults and refreshes it). The manager's in-memory cache is kept
//! fully pinned by other chats (same trick as `history_eviction`), so every
//! `get_messages("c1")` is a cold load and the only thing that can stop it
//! from calling `load_history` again is a snapshot hit.
use super::*;
use serde_json::json;
use std::path::PathBuf;

fn history() -> ChatMessage {
    serde_json::from_value(json!({"id":"m1","chatId":"c1","type":"assistant",
        "timestamp":"2026-10-02T00:00:00Z","content":[{"type":"text","text":"hello"}]}))
    .unwrap()
}

/// A manager whose `c1` always loads cold, backed by one stat-able fake
/// transcript file and a cache dir this test alone owns.
pub(super) async fn cold_manager(dir: &tempfile::TempDir) -> (Arc<FakeDeps>, ChatManager, PathBuf) {
    let transcript = dir.path().join("session.jsonl");
    tokio::fs::write(&transcript, "{\"line\":1}\n")
        .await
        .unwrap();
    let mut chat = test_chat("c1");
    chat.vendor_session_id = Some("session".into());
    let deps = FakeDeps::with_chats(vec![chat]);
    *deps.adapters.history.lock().unwrap() = Some(vec![history()]);
    *deps.adapters.transcript_present.lock().unwrap() = Some(true);
    deps.set_history_sources(vec![transcript.clone()]);
    deps.set_history_cache_dir(&dir.path().join("cache").to_string_lossy());
    let manager = ChatManager::new(deps.clone());
    {
        let mut cache = manager.shared.messages.lock().unwrap();
        for id in 0..50 {
            let chat_id = format!("pinned-{id}");
            cache.pin(&chat_id);
            cache.set(&chat_id, vec![history()]);
        }
    }
    (deps, manager, transcript)
}

#[tokio::test]
async fn a_second_cold_load_of_an_unchanged_transcript_hits_the_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    let (deps, manager, _) = cold_manager(&dir).await;

    assert_eq!(manager.get_messages("c1").await, vec![history()]);
    assert_eq!(deps.adapters.history_loads.load(Ordering::SeqCst), 1);
    manager.shared.history_cache.flush().await;
    assert!(manager.shared.messages.lock().unwrap().get("c1").is_none());

    assert_eq!(manager.get_messages("c1").await, vec![history()]);
    assert_eq!(
        deps.adapters.history_loads.load(Ordering::SeqCst),
        1,
        "an unchanged transcript must be served from the snapshot, not reparsed"
    );
}

#[tokio::test]
async fn a_changed_transcript_misses_the_snapshot_and_reparses() {
    let dir = tempfile::tempdir().unwrap();
    let (deps, manager, transcript) = cold_manager(&dir).await;

    manager.get_messages("c1").await;
    manager.shared.history_cache.flush().await;

    // Grow the file: a new length is a fingerprint miss on its own, without
    // depending on mtime granularity.
    tokio::fs::write(&transcript, "{\"line\":1}\n{\"line\":2}\n")
        .await
        .unwrap();
    assert_eq!(manager.get_messages("c1").await, vec![history()]);
    assert_eq!(
        deps.adapters.history_loads.load(Ordering::SeqCst),
        2,
        "a changed transcript must be reparsed"
    );
}

#[tokio::test]
async fn a_session_without_history_sources_never_touches_the_cache() {
    let dir = tempfile::tempdir().unwrap();
    let (deps, manager, _) = cold_manager(&dir).await;
    deps.set_history_sources(Vec::new());

    manager.get_messages("c1").await;
    manager.get_messages("c1").await;
    manager.shared.history_cache.flush().await;
    assert_eq!(deps.adapters.history_loads.load(Ordering::SeqCst), 2);
    assert!(
        tokio::fs::metadata(dir.path().join("cache")).await.is_err(),
        "no snapshot dir should appear for an adapter that opted out"
    );
}

#[tokio::test]
async fn lifecycle_restoration_reuses_a_snapshot_after_manager_restart() {
    let dir = tempfile::tempdir().unwrap();
    let (deps, first, _) = cold_manager(&dir).await;
    first.load_chat("c1").await;
    first.shared.history_cache.flush().await;
    first.dispose();
    assert_eq!(deps.adapters.history_loads.load(Ordering::SeqCst), 1);

    let second = ChatManager::new(deps.clone());
    second.resume_transcript("c1").await;
    assert_eq!(second.get_messages("c1").await, vec![history()]);
    assert_eq!(deps.adapters.history_loads.load(Ordering::SeqCst), 1);
    second.dispose();
}

#[tokio::test]
async fn lifecycle_restoration_reloads_a_changed_source_after_restart() {
    let dir = tempfile::tempdir().unwrap();
    let (deps, first, transcript) = cold_manager(&dir).await;
    first.load_chat("c1").await;
    first.shared.history_cache.flush().await;
    first.dispose();
    tokio::fs::write(transcript, "changed source contents")
        .await
        .unwrap();
    let mut replacement = history();
    replacement.id = "replacement".into();
    *deps.adapters.history.lock().unwrap() = Some(vec![replacement.clone()]);

    let second = ChatManager::new(deps.clone());
    second.resume_transcript("c1").await;
    assert_eq!(second.get_messages("c1").await, vec![replacement]);
    assert_eq!(deps.adapters.history_loads.load(Ordering::SeqCst), 2);
    second.dispose();
}

#[tokio::test]
async fn lifecycle_restoration_recovers_from_corrupt_persisted_history() {
    let dir = tempfile::tempdir().unwrap();
    let (deps, first, _) = cold_manager(&dir).await;
    first.load_chat("c1").await;
    first.shared.history_cache.flush().await;
    first.dispose();
    tokio::fs::write(dir.path().join("cache/c1.json"), "broken")
        .await
        .unwrap();

    let second = ChatManager::new(deps.clone());
    second.resume_transcript("c1").await;
    assert_eq!(second.get_messages("c1").await, vec![history()]);
    assert_eq!(deps.adapters.history_loads.load(Ordering::SeqCst), 2);
    second.dispose();
}

fn reply() -> ChatMessage {
    let mut reply = history();
    reply.id = "m2".into();
    reply
}

/// A turn appends to the transcript; the adapter now parses one more message.
pub(super) async fn run_a_turn(deps: &FakeDeps, transcript: &std::path::Path) {
    tokio::fs::write(transcript, "{\"line\":1}\n{\"line\":2}\n")
        .await
        .unwrap();
    *deps.adapters.history.lock().unwrap() = Some(vec![history(), reply()]);
}

#[tokio::test]
async fn a_refresh_after_a_turn_lets_the_next_start_restore_without_a_parse() {
    let dir = tempfile::tempdir().unwrap();
    let (deps, first, transcript) = cold_manager(&dir).await;
    first.load_chat("c1").await;
    first.shared.history_cache.flush().await;
    run_a_turn(&deps, &transcript).await;

    let refreshed = first.refresh_history_cache("c1").await.unwrap();
    assert!(refreshed.validation.permission_free);
    assert_eq!(refreshed.messages.len(), 2);
    assert_eq!(deps.adapters.history_loads.load(Ordering::SeqCst), 2);
    first.dispose();

    let second = ChatManager::new(deps.clone());
    second.resume_transcript("c1").await;
    assert_eq!(second.get_messages("c1").await, vec![history(), reply()]);
    assert_eq!(
        deps.adapters.history_loads.load(Ordering::SeqCst),
        2,
        "the restart must restore the refreshed snapshot, not parse again"
    );
    second.dispose();
}

#[tokio::test]
async fn a_change_after_the_refresh_falls_back_to_the_full_read() {
    let dir = tempfile::tempdir().unwrap();
    let (deps, first, transcript) = cold_manager(&dir).await;
    first.load_chat("c1").await;
    run_a_turn(&deps, &transcript).await;
    first.refresh_history_cache("c1").await.unwrap();
    first.dispose();
    tokio::fs::write(&transcript, "{\"line\":1}\n{\"line\":2}\n{\"line\":3}\n")
        .await
        .unwrap();
    let mut later = history();
    later.id = "m3".into();
    *deps.adapters.history.lock().unwrap() = Some(vec![history(), reply(), later.clone()]);
    let loads = deps.adapters.history_loads.load(Ordering::SeqCst);

    let second = ChatManager::new(deps.clone());
    second.resume_transcript("c1").await;
    assert_eq!(second.get_messages("c1").await, vec![history(), reply(), later]);
    assert_eq!(deps.adapters.history_loads.load(Ordering::SeqCst), loads + 1);
    second.dispose();
}

#[tokio::test]
async fn an_uncacheable_chat_is_not_refreshed() {
    let dir = tempfile::tempdir().unwrap();
    let (deps, manager, _) = cold_manager(&dir).await;
    deps.set_history_sources(Vec::new());
    assert!(manager.refresh_history_cache("c1").await.is_none());
    assert!(tokio::fs::metadata(dir.path().join("cache/c1.json")).await.is_err());
}

/// The CLI process stays up between turns, so a just-finished chat still has a
/// spawned session; only an in-flight turn may stop the refresh.
fn seed_live_session(manager: &ChatManager, state: mainframe_types::chat::ProcessState) {
    let mut chat = test_chat("c1");
    chat.vendor_session_id = Some("session".into());
    chat.process_state = Some(Some(state));
    seed_active(manager, "c1", chat, Arc::new(mainframe_adapter_api::test_support::FakeSession::spawned()));
}

#[tokio::test]
async fn a_chat_whose_cli_stays_up_after_the_turn_is_refreshed() {
    use mainframe_types::chat::ProcessState;
    let dir = tempfile::tempdir().unwrap();
    let (deps, manager, transcript) = cold_manager(&dir).await;
    seed_live_session(&manager, ProcessState::Idle);
    assert!(manager.is_chat_running("c1"));
    run_a_turn(&deps, &transcript).await;
    assert!(manager.refresh_history_cache("c1").await.is_some());

    seed_live_session(&manager, ProcessState::Working);
    assert!(
        manager.refresh_history_cache("c1").await.is_none(),
        "a turn in flight is never cached"
    );
}

#[tokio::test]
async fn a_refresh_leaves_the_held_prompt_queue_alone() {
    let dir = tempfile::tempdir().unwrap();
    let (deps, manager, transcript) = cold_manager(&dir).await;
    let db = mainframe_db::actor::SqliteActor::spawn(|| {
        let d = mainframe_db::DatabaseManager::open(std::path::Path::new(":memory:"))?;
        d.connection().execute("INSERT INTO projects(id,name,path,created_at,last_opened_at) VALUES ('p1','p','/p','','')", [])?;
        d.connection().execute("INSERT INTO chats(id,project_id,adapter_id,status,created_at,updated_at) VALUES ('c1','p1','claude','active','','')", [])?;
        Ok(d)
    })
    .unwrap();
    assert!(deps.store.idle_db.set(db).is_ok());
    let held = |id: &str| mainframe_db::idle_compaction_queue::QueuedInput {
        delivery: Default::default(),
        uuid: id.into(),
        content: "held".into(),
        prepared_text: "held".into(),
        text_prefix: String::new(),
        images: Vec::new(),
        attachment_ids: None,
        command: None,
        message: {
            let mut message = history();
            message.id = id.into();
            message
        },
    };
    // "m2" was delivered (the turn wrote it); "q9" is still waiting.
    deps.idle_queue_put("c1", &held("m2")).unwrap();
    deps.idle_queue_put("c1", &held("q9")).unwrap();
    run_a_turn(&deps, &transcript).await;

    let refreshed = manager.refresh_history_cache("c1").await.unwrap();
    assert_eq!(refreshed.messages.len(), 3, "the waiting prompt shows, as after a restart");
    let queued: Vec<_> = deps
        .idle_queue_list("c1")
        .unwrap()
        .into_iter()
        .map(|input| input.uuid)
        .collect();
    assert_eq!(queued, ["m2", "q9"], "only the real echo may acknowledge a held prompt");
    assert!(manager.shared.queued_for_chat("c1").is_empty());
}

#[path = "chat_manager_tests_history_validation.rs"]
mod validation;

#[path = "chat_manager_tests_history_refresh_mode.rs"]
mod refresh_mode;
