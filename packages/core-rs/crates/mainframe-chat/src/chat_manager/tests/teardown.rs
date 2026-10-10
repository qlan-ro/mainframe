//! Per-chat teardown (`ChatTeardown`): what discard, archive, end and idle
//! offload each drop and what each keeps. Every mode preserves what its path
//! kept before the paths shared one helper; the only change is that discard
//! now forgets the chat's worktree offers.

use super::*;
use crate::chat_teardown::TeardownMode;
use mainframe_types::adapter::ControlRequest;

fn prompt(request_id: &str) -> ControlRequest {
    ControlRequest {
        request_id: request_id.to_string(),
        tool_name: "Bash".to_string(),
        tool_use_id: format!("tu-{request_id}"),
        input: std::collections::HashMap::new(),
        suggestions: Vec::new(),
        decision_reason: None,
        options: None,
    }
}

/// Gives "c1" every kind of per-chat state a teardown touches, plus an offer
/// on "c2" that no teardown of "c1" may touch.
fn seed_state(mgr: &ChatManager, chat: Chat) {
    seed_active(mgr, "c1", chat, RecSession::new("c1", false, true));
    {
        let mut messages = mgr.messages.lock().unwrap();
        messages.set("c1", Vec::new());
        messages.pin("c1");
    }
    {
        let mut permissions = mgr.permissions.lock().unwrap();
        permissions.enqueue("c1", prompt("cancelled"));
        permissions.enqueue("c1", prompt("pending"));
        permissions.cancel("c1", "cancelled");
        permissions.mark_interrupted("c1");
    }
    mgr.worktree_offers.seed_pending_for_test("c1", "/tmp/wt");
    mgr.worktree_offers
        .seed_pending_for_test("c2", "/tmp/other");
}

#[derive(Debug, PartialEq)]
struct Left {
    active: bool,
    cached: bool,
    pinned: bool,
    pending_prompt: bool,
    cancelled_tombstone: bool,
    interrupted: bool,
    offers: usize,
    other_chat_offers: usize,
}

fn left(mgr: &ChatManager) -> Left {
    let messages = mgr.messages.lock().unwrap();
    let mut permissions = mgr.permissions.lock().unwrap();
    Left {
        active: mgr.get_active("c1").is_some(),
        cached: messages.get("c1").is_some(),
        pinned: messages.is_pinned("c1"),
        pending_prompt: permissions.has_pending("c1"),
        cancelled_tombstone: permissions.was_cancelled("c1", "cancelled"),
        interrupted: permissions.clear_interrupted("c1"),
        offers: mgr.worktree_offers_for_chat("c1").len(),
        other_chat_offers: mgr.worktree_offers_for_chat("c2").len(),
    }
}

fn expected(mode: TeardownMode) -> Left {
    match mode {
        TeardownMode::Discard => Left {
            active: false,
            cached: false,
            pinned: false,
            pending_prompt: false,
            cancelled_tombstone: false,
            interrupted: false,
            offers: 0,
            other_chat_offers: 1,
        },
        TeardownMode::Archive => Left {
            active: false,
            cached: false,
            pinned: false,
            pending_prompt: false,
            cancelled_tombstone: true,
            interrupted: false,
            offers: 0,
            other_chat_offers: 1,
        },
        TeardownMode::End => Left {
            active: false,
            cached: true,
            pinned: false,
            pending_prompt: true,
            cancelled_tombstone: true,
            interrupted: true,
            offers: 0,
            other_chat_offers: 1,
        },
        TeardownMode::Offload => Left {
            active: false,
            cached: false,
            pinned: false,
            pending_prompt: false,
            cancelled_tombstone: false,
            interrupted: false,
            offers: 1,
            other_chat_offers: 1,
        },
    }
}

#[tokio::test]
async fn each_mode_keeps_only_its_own_slice_of_chat_state() {
    for mode in [
        TeardownMode::Discard,
        TeardownMode::Archive,
        TeardownMode::End,
        TeardownMode::Offload,
    ] {
        let mgr = ChatManager::new(StoreDeps::with_chats(vec![test_chat("c1")]));
        seed_state(&mgr, test_chat("c1"));

        mgr.teardown.clear("c1", mode);

        assert_eq!(left(&mgr), expected(mode), "{mode:?}");
    }
}

#[tokio::test]
async fn discard_chat_forgets_the_chats_worktree_offers() {
    let mut chat = test_chat("c1");
    chat.temporary = true;
    let mgr = ChatManager::new(StoreDeps::with_chats(vec![chat.clone()]));
    seed_state(&mgr, chat);

    mgr.discard_chat("c1").await.unwrap();

    assert_eq!(left(&mgr), expected(TeardownMode::Discard));
}

#[tokio::test]
async fn archive_chat_clears_through_the_archive_mode() {
    let mgr = ChatManager::new(StoreDeps::with_chats(vec![test_chat("c1")]));
    seed_state(&mgr, test_chat("c1"));

    mgr.archive_chat("c1", false).await;

    assert_eq!(left(&mgr), expected(TeardownMode::Archive));
}

#[tokio::test]
async fn end_chat_clears_through_the_end_mode() {
    let mgr = ChatManager::new(StoreDeps::with_chats(vec![test_chat("c1")]));
    seed_state(&mgr, test_chat("c1"));

    mgr.end_chat("c1").await;

    assert_eq!(left(&mgr), expected(TeardownMode::End));
}
