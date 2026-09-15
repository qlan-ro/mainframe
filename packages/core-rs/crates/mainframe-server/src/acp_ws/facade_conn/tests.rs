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

fn holds(connection: &FacadeConnection, chat_id: &str) -> bool {
    connection
        .prompt_locks
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .contains_key(chat_id)
}

#[test]
fn forget_chat_drops_a_prompt_lock_nobody_is_holding() {
    let (connection, _rx) = connection();
    drop(connection.session_prompt_lock("chat-1"));
    drop(connection.session_prompt_lock("chat-2"));
    assert_eq!(lock_count(&connection), 2);

    connection.forget_chat("chat-1");

    assert!(!holds(&connection, "chat-1"));
    assert_eq!(lock_count(&connection), 1, "other chats keep their locks");
}

/// A detach mid-prompt must not hand the next prompt for that session a
/// fresh mutex: the in-flight one still holds the old `Arc`, and two prompts
/// under two different locks would enqueue concurrently — the ordering the
/// lock exists to guarantee.
#[test]
fn forget_chat_keeps_a_prompt_lock_an_in_flight_prompt_still_holds() {
    let (connection, _rx) = connection();
    let in_flight = connection.session_prompt_lock("chat-1");

    connection.forget_chat("chat-1");
    assert!(
        holds(&connection, "chat-1"),
        "the running prompt's lock must survive the detach"
    );

    // The prompt finished; the next teardown reclaims it.
    drop(in_flight);
    connection.forget_chat("chat-1");
    assert!(!holds(&connection, "chat-1"));
}
