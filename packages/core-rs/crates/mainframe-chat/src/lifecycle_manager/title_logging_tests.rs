//! `do_generate_title` observability tests (#287).
//!
//! Every case installs a `LogCapture` guard and asserts on the captured
//! `(level, reason)` events plus the title-retention invariants — never on a
//! formatted message string.

use std::sync::{Arc, Mutex};

use mainframe_types::chat::ChatStatus;
use mainframe_types::events::DaemonEvent;
use tracing::Level;

use super::tests::{FakeDeps, chat_over, manager};
use crate::test_support::LogCapture;
use crate::types::ActiveChat;

/// One captured event: its level, and the `reason` field it carried (if any)
/// — mirrors the return type of `LogCapture::install()`.
type CapturedEvents = Arc<Mutex<Vec<(Level, Option<String>)>>>;

/// Every case here installs a capture guard, drives `do_generate_title` once,
/// and expects exactly one reason-bearing event plus the same three
/// title-retention invariants; only the reason token (and, for two of the
/// three cases, an extra check of the cell's own title) differs per test.
fn assert_logged_once_and_title_untouched(
    events: &CapturedEvents,
    expected_reason: &str,
    deps: &FakeDeps,
) {
    assert_eq!(
        LogCapture::events_with_reason(events),
        vec![(Level::DEBUG, expected_reason.to_string())]
    );
    assert!(deps.title_updates.lock().unwrap().is_empty());
    assert!(
        !deps
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
    let deps = FakeDeps::new(chat, Vec::new());
    let mgr = manager(deps.clone());
    // Nothing inserted into active_chats: the spawned title task lost the
    // race against chat eviction.

    let (subscriber, events) = LogCapture::install();
    let _guard = tracing::subscriber::set_default(subscriber);
    mgr.do_generate_title("c1", "some first message").await;

    assert_logged_once_and_title_untouched(&events, "chat_not_active", &deps);
}

#[tokio::test]
async fn disabled_setting_logs_disabled_by_setting() {
    let mut chat = chat_over("c1", None, ChatStatus::Active);
    chat.title = Some("Fallback Title".to_string());
    let deps = FakeDeps::title_disabled(chat.clone());
    let mgr = manager(deps.clone());
    let cell = Arc::new(Mutex::new(ActiveChat {
        chat,
        session: None,
        turn_started_at: None,
    }));
    mgr_insert(&mgr, "c1", cell.clone());

    let (subscriber, events) = LogCapture::install();
    let _guard = tracing::subscriber::set_default(subscriber);
    mgr.do_generate_title("c1", "some first message").await;

    assert_logged_once_and_title_untouched(&events, "disabled_by_setting", &deps);
    assert_eq!(
        cell.lock().unwrap().chat.title.as_deref(),
        Some("Fallback Title")
    );
}

#[tokio::test]
async fn none_outcome_logs_no_title_and_keeps_the_fallback() {
    let mut chat = chat_over("c1", None, ChatStatus::Active);
    chat.title = Some("Fallback Title".to_string());
    let deps = FakeDeps::new(chat.clone(), Vec::new());
    let mgr = manager(deps.clone());
    let cell = Arc::new(Mutex::new(ActiveChat {
        chat,
        session: None,
        turn_started_at: None,
    }));
    mgr_insert(&mgr, "c1", cell.clone());

    let (subscriber, events) = LogCapture::install();
    let _guard = tracing::subscriber::set_default(subscriber);
    mgr.do_generate_title("c1", "some first message").await;

    assert_logged_once_and_title_untouched(&events, "no_title", &deps);
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
fn mgr_insert(
    mgr: &super::ChatLifecycleManager<FakeDeps>,
    chat_id: &str,
    cell: Arc<Mutex<ActiveChat>>,
) {
    mgr.active_chats.insert(chat_id.to_string(), cell);
}
