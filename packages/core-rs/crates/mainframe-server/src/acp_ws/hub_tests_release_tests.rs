//! The idle history release on the hub: a released chat's revision log goes,
//! unless a reconnect attached first, and a reconnect after the drop starts a
//! new epoch so an old cursor replays in full.

use mainframe_acp::revision_log::ReplayPlan;
use mainframe_types::sync::LockExt as _;

use super::*;

fn logged_chat(hub: &FacadeHub, chat_id: &str) {
    hub.revision_log_for_resume(true, chat_id);
}

fn released(chat_id: &str) -> ChatSurfaceEvent {
    ChatSurfaceEvent::HistoryReleased {
        chat_id: chat_id.to_string(),
    }
}

#[tokio::test]
async fn a_released_history_drops_the_log_and_the_next_revision_records_nothing() {
    let hub = hub();
    logged_chat(&hub, "chat-1");
    logged_chat(&hub, "chat-2");

    hub.on_chat_surface_event(released("chat-1"));
    hub.on_chat_surface_event(revision("chat-1", "Hello"));

    assert!(
        hub.revision_boundary("chat-1").is_none(),
        "the encoded copy of the released history is gone"
    );
    assert!(
        hub.revision_boundary("chat-2").is_some(),
        "other chats keep theirs"
    );
}

#[tokio::test]
async fn a_chat_is_viewed_while_a_connection_holds_a_session_on_it() {
    let hub = hub();
    let (client_id, connection, _rx) = hub.register("desktop".to_string());
    assert!(!hub.is_viewing("chat-1"));

    hub.attach(&connection, "chat-1");
    assert!(hub.is_viewing("chat-1"));
    assert!(!hub.is_viewing("chat-2"));

    connection.forget_chat("chat-1");
    assert!(
        !hub.is_viewing("chat-1"),
        "session_detach leaves the chat unviewed"
    );

    hub.attach(&connection, "chat-1");
    hub.unregister(&client_id);
    assert!(
        !hub.is_viewing("chat-1"),
        "a closed connection views nothing"
    );
}

#[tokio::test]
async fn a_reconnect_that_attached_before_the_release_keeps_its_cursor_epoch() {
    let hub = hub();
    logged_chat(&hub, "chat-1");
    hub.on_chat_surface_event(revision("chat-1", "Hello"));
    let old = hub.revision_boundary("chat-1").unwrap();
    let (_id, conn, _rx) = hub.register("mock-cli".to_string());
    conn.mark_revision_cursors_opted_in();
    let (_log, cursor) = hub.begin_resume(&conn, "chat-1").unwrap();
    assert_eq!(cursor.epoch, old.epoch);

    hub.on_chat_surface_event(released("chat-1"));

    assert_eq!(
        hub.revision_boundary("chat-1").map(|c| c.epoch),
        Some(old.epoch),
        "the log the reconnect took its cursor from stays"
    );
}

#[tokio::test]
async fn a_reconnect_after_the_release_gets_a_new_epoch_and_an_old_cursor_replays_in_full() {
    let hub = hub();
    logged_chat(&hub, "chat-1");
    hub.on_chat_surface_event(revision("chat-1", "Hello"));
    let old = hub.revision_boundary("chat-1").unwrap();

    hub.on_chat_surface_event(released("chat-1"));
    let (_id, conn, _rx) = hub.register("mock-cli".to_string());
    conn.mark_revision_cursors_opted_in();
    let (log, cursor) = hub.begin_resume(&conn, "chat-1").unwrap();

    assert_ne!(cursor.epoch, old.epoch);
    assert!(matches!(
        log.lock_recover().plan(&old, &[]),
        ReplayPlan::Full
    ));
}
