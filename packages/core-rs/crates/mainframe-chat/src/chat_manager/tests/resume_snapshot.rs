//! `get_resume_snapshot`'s transcript budget (todo #350, PR #688 review). The
//! facade calls this on every `session/resume`, and a cold chat's load walks
//! the whole JSONL — so it must happen once per resume, not once per caller
//! inside it.

use super::*;

/// The snapshot loads history itself, and `get_messages` restores any pending
/// permission from that same load. Asking the permission handler afterwards
/// must read what was restored, not reload the transcript to look again.
#[tokio::test]
async fn a_resume_snapshot_loads_the_transcript_once() {
    let mut chat = test_chat("c1");
    chat.claude_session_id = Some("sess-1".to_string());
    let deps = StoreDeps::with_chats(vec![chat]);
    *deps.history.lock().unwrap() = Some(vec![history_message()]);
    // Transcript present: reconcile leaves the chat's session id in place, so
    // the pending-permission lookup can still reach a history session.
    *deps.transcript_present.lock().unwrap() = Some(true);
    let mgr = ChatManager::new(deps.clone());

    let (_messages, pending) = mgr.get_resume_snapshot("c1").await;

    assert!(pending.is_none(), "this fixture has no open gate");
    assert_eq!(
        deps.history_loads.load(Ordering::SeqCst),
        1,
        "one resume, one transcript load"
    );
}
