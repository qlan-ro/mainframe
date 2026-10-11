use super::*;

#[tokio::test]
async fn idle_keys_are_evicted_without_replacing_a_live_owner() {
    let locks = KeyedMutex::default();
    let owner = locks.get("first");
    let guard = owner.clone().lock_owned().await;
    let waiter = locks.get("first");
    assert!(Arc::ptr_eq(&owner, &waiter));
    assert!(waiter.try_lock().is_err());
    let other = locks.acquire("second").await;
    assert_eq!(locks.0.lock_recover().len(), 2);
    drop(other);
    drop(guard);
    drop(owner);
    locks.prune();
    assert_eq!(locks.0.lock_recover().len(), 1);
    assert!(Arc::ptr_eq(&waiter, &locks.get("first")));
    drop(waiter);
    locks.prune();
    assert_eq!(locks.0.lock_recover().len(), 0);
}

#[tokio::test]
async fn aborted_waiter_does_not_split_lock_ownership() {
    let locks = Arc::new(KeyedMutex::default());
    let held = locks.acquire("key").await;
    let waiting = locks.clone();
    let task = tokio::spawn(async move { waiting.acquire("key").await });
    tokio::task::yield_now().await;
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    locks.prune();
    assert!(locks.get("key").try_lock().is_err());
    drop(held);
    locks.prune();
    assert_eq!(locks.0.lock_recover().len(), 0);
}
#[tokio::test]
async fn queued_callers_preserve_fifo_without_blocking_other_keys() {
    let locks = KeyedMutex::default();
    let first = locks.acquire("first").await;
    let later = locks.acquire("first");
    tokio::pin!(later);
    assert!(
        std::future::poll_fn(|cx| {
            std::task::Poll::Ready(std::future::Future::poll(later.as_mut(), cx).is_pending())
        })
        .await
    );
    let other = locks.acquire("other").await;
    drop(other);
    drop(first);
    let resumed = tokio::time::timeout(std::time::Duration::from_secs(1), later).await;
    assert!(resumed.is_ok());
}
