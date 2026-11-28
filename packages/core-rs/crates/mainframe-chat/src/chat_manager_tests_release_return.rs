//! Returning to a released chat: the history comes back into the live cell
//! before any append and before any process starts.

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
}

#[tokio::test]
async fn a_resume_of_a_released_chat_reads_the_whole_history_back() {
    let f = fixture();
    scan(&f.mgr).await;

    let snapshot = f.mgr.get_resume_snapshot("c1").await;

    assert_eq!(snapshot.messages.len(), 2);
    assert!(holds_history(&f.mgr));
}
