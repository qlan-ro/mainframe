//! Returning to a released chat: the history comes back into the live cell,
//! before any append, and a first view may open from disk as a first open does.

use super::*;

#[tokio::test]
async fn loading_a_released_chat_restores_its_history_into_the_live_cell() {
    let f = fixture();
    let cell = f.mgr.shared.active("c1").unwrap();
    scan(&f.mgr).await;

    f.mgr.lifecycle.load_chat("c1").await;

    assert_eq!(cached_ids(&f.mgr), ["m1", "m2"]);
    assert!(!f.mgr.shared.messages.lock().unwrap().is_released("c1"));
    let kept = f.mgr.shared.active("c1").unwrap();
    assert!(
        Arc::ptr_eq(&cell, &kept),
        "the restore never replaces the cell"
    );
    let session = kept.lock().unwrap().session.clone().unwrap();
    let live: Arc<dyn mainframe_adapter_api::AdapterSession> = f.session.clone();
    assert!(Arc::ptr_eq(&session, &live), "nor the live CLI session");
    assert_eq!(f.session.kills(), 0);
}

#[tokio::test]
async fn a_send_to_a_released_chat_restores_the_history_before_appending() {
    let f = fixture();
    scan(&f.mgr).await;

    f.mgr
        .send_message("c1", "hello again", None, None)
        .await
        .expect("the live CLI takes the send");

    let ids = cached_ids(&f.mgr);
    assert_eq!(ids.len(), 3, "the whole history, then the new message");
    assert_eq!(&ids[..2], ["m1", "m2"]);
    assert_eq!(f.session.kills(), 0, "no respawn");
}

#[tokio::test]
async fn a_resume_of_a_released_chat_reads_the_whole_history_back() {
    let f = fixture();
    scan(&f.mgr).await;

    let snapshot = f.mgr.get_resume_snapshot("c1").await;

    assert_eq!(snapshot.messages.len(), 2);
    assert!(holds_history(&f.mgr));
}

#[tokio::test]
async fn a_released_chat_with_an_idle_cli_may_open_from_disk_like_a_first_open() {
    let f = fixture();
    assert!(
        !f.mgr.initial_history_eligible("c1"),
        "a chat holding its history in memory never opens from disk"
    );

    scan(&f.mgr).await;

    assert!(
        f.mgr.initial_history_eligible("c1"),
        "its idle CLI writes nothing, so a tail or the adapter's pages can answer"
    );
}
