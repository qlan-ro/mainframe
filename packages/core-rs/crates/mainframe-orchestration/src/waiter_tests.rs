use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex};

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

static NOTED: LazyLock<Mutex<Vec<String>>> = LazyLock::new(Mutex::default);

fn noted(id: &str) -> usize {
    NOTED.lock().unwrap().iter().filter(|n| *n == id).count()
}

fn record_activity() {
    on_watch_activity(|id| NOTED.lock().unwrap().push(id.to_owned()));
}

#[tokio::test]
async fn a_wait_counts_as_use_when_it_starts_and_when_it_ends() {
    record_activity();
    let (tx, rx) = tokio::sync::broadcast::channel(4);
    let ids = vec!["waiter-activity-ends".to_string()];
    let during = AtomicBool::new(false);

    wait_on(rx, Duration::from_millis(20), &ids, || async {
        during.store(noted("waiter-activity-ends") == 1, Ordering::SeqCst);
        None::<()>
    })
    .await;
    drop(tx);

    assert!(during.load(Ordering::SeqCst), "noted when the watch starts");
    assert_eq!(noted("waiter-activity-ends"), 2, "and again when it ends");
}

#[tokio::test]
async fn a_cancelled_wait_still_counts_its_end_as_use() {
    record_activity();
    let (tx, rx) = tokio::sync::broadcast::channel(4);
    let wait = tokio::spawn(async move {
        let ids = vec!["waiter-activity-cancelled".to_string()];
        wait_on(rx, Duration::from_secs(600), &ids, || async { None::<()> }).await;
    });
    while noted("waiter-activity-cancelled") == 0 {
        tokio::task::yield_now().await;
    }

    wait.abort();
    assert!(wait.await.unwrap_err().is_cancelled());
    drop(tx);

    assert_eq!(noted("waiter-activity-cancelled"), 2);
}
