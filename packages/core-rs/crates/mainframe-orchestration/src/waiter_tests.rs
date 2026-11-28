use super::*;
use std::sync::atomic::{AtomicBool, Ordering};

#[tokio::test]
async fn a_wait_marks_its_chats_watched_until_it_ends() {
    let (tx, rx) = tokio::sync::broadcast::channel(4);
    let ids = vec![
        "waiter-watched-a".to_string(),
        "waiter-watched-b".to_string(),
    ];
    let seen = AtomicBool::new(false);
    let end = wait_on(rx, Duration::from_millis(20), &ids, || async {
        seen.store(
            is_watched("waiter-watched-a") && is_watched("waiter-watched-b"),
            Ordering::SeqCst,
        );
        None::<()>
    })
    .await;
    drop(tx);

    assert!(matches!(end, WaitEnd::TimedOut));
    assert!(seen.load(Ordering::SeqCst), "watched while the wait runs");
    assert!(!is_watched("waiter-watched-a"), "forgotten once it ends");
    assert!(!is_watched("waiter-watched-b"));
}

#[tokio::test]
async fn overlapping_waits_keep_a_chat_watched_until_the_last_one_ends() {
    let ids = vec!["waiter-watched-shared".to_string()];
    let first = Watching::new(&ids);
    let second = Watching::new(&ids);
    drop(first);
    assert!(is_watched("waiter-watched-shared"));
    drop(second);
    assert!(!is_watched("waiter-watched-shared"));
}
