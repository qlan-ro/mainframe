use std::sync::{Arc, Mutex};

use mainframe_types::chat::ChatStatus;
use mainframe_types::events::DaemonEvent;

use super::tests::{FakeDeps, chat_over, fake, manager, title_disabled, title_updates};
use crate::types::ActiveChat;

fn assert_title_untouched(deps: &FakeDeps) {
    assert!(title_updates(deps).is_empty());
    assert!(
        !deps
            .emitter
            .events
            .lock()
            .unwrap()
            .iter()
            .any(|e| matches!(e, DaemonEvent::ChatUpdated { .. }))
    );
}

#[tokio::test]
async fn evicted_chat_logs_chat_not_active_and_leaves_the_title_alone() {
    let chat = chat_over("c1", None, ChatStatus::Active);
    let deps = fake(chat, Vec::new());
    let mgr = manager(deps.clone());
    // Nothing inserted into active_chats: the spawned title task lost the
    // race against chat eviction.

    mgr.do_generate_title("c1", "some first message").await;

    assert_title_untouched(&deps);
    assert!(
        deps.adapters
            .generate_title_calls
            .lock()
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn disabled_setting_logs_disabled_by_setting() {
    let mut chat = chat_over("c1", None, ChatStatus::Active);
    chat.title = Some("Fallback Title".to_string());
    let deps = title_disabled(chat.clone());
    let mgr = manager(deps.clone());
    let cell = Arc::new(Mutex::new(ActiveChat::new(chat, None)));
    mgr_insert(&mgr, "c1", cell.clone());

    mgr.do_generate_title("c1", "some first message").await;

    assert_title_untouched(&deps);
    assert!(
        deps.adapters
            .generate_title_calls
            .lock()
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        cell.lock().unwrap().chat.title.as_deref(),
        Some("Fallback Title")
    );
}

#[tokio::test]
async fn none_outcome_logs_no_title_and_keeps_the_fallback() {
    let mut chat = chat_over("c1", None, ChatStatus::Active);
    chat.title = Some("Fallback Title".to_string());
    let deps = fake(chat.clone(), Vec::new());
    let mgr = manager(deps.clone());
    let cell = Arc::new(Mutex::new(ActiveChat::new(chat, None)));
    mgr_insert(&mgr, "c1", cell.clone());

    mgr.do_generate_title("c1", "some first message").await;

    assert_title_untouched(&deps);
    assert_eq!(
        *deps.adapters.generate_title_calls.lock().unwrap(),
        ["some first message"]
    );
    assert_eq!(
        cell.lock().unwrap().chat.title.as_deref(),
        Some("Fallback Title")
    );
}

/// `ChatLifecycleManager::active_chats` is a private field of the parent
/// module; `title_logging_tests` is a sibling (not a descendant) of `tests`,
/// so it reaches the registry through the manager's own crate-visible type
/// rather than reconstructing one — inserting directly mirrors what
/// `super::tests` does inline.
fn mgr_insert(mgr: &super::ChatLifecycleManager, chat_id: &str, cell: Arc<Mutex<ActiveChat>>) {
    mgr.shared.active_chats.insert(chat_id.to_string(), cell);
}

#[test]
fn failed_title_write_emits_the_live_title() {
    let chat = chat_over("c1", None, ChatStatus::Active);
    let deps = fake(chat.clone(), Vec::new());
    let mgr = manager(deps.clone());
    let cell = Arc::new(Mutex::new(ActiveChat::new(chat, None)));
    *deps.store.write_failure.lock().unwrap() = Some("write failed".into());
    mgr.apply_generated_title(&cell, "Generated".into());
    assert!(matches!(deps.events().as_slice(), [
        DaemonEvent::Error { chat_id: Some(id), .. },
        DaemonEvent::ChatUpdated { chat, reason: None }
    ] if id == "c1" && chat.title.as_deref() == Some("Generated")));
}
