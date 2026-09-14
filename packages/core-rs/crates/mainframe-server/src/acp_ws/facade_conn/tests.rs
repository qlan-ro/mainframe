//! Per-connection bookkeeping lifecycle: what `forget_chat` must reclaim so a
//! long-lived connection does not accumulate per-chat state for chats that
//! ended (todo #350, PR #688 review).

use super::*;

fn connection() -> (FacadeConnection, mpsc::UnboundedReceiver<String>) {
    let (tx, rx) = mpsc::unbounded_channel();
    (FacadeConnection::new("mock-cli".to_string(), tx), rx)
}

fn lock_count(connection: &FacadeConnection) -> usize {
    connection
        .prompt_locks
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .len()
}

#[test]
fn forget_chat_drops_the_chats_prompt_lock() {
    let (connection, _rx) = connection();
    let _lock = connection.session_prompt_lock("chat-1");
    let _other = connection.session_prompt_lock("chat-2");
    assert_eq!(lock_count(&connection), 2);

    connection.forget_chat("chat-1");

    assert!(
        !connection
            .prompt_locks
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains_key("chat-1"),
        "the ended chat's prompt lock must be reclaimed"
    );
    assert_eq!(lock_count(&connection), 1, "other chats keep their locks");
}
