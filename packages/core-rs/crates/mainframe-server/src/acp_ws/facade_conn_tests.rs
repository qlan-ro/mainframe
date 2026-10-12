//! Per-connection bookkeeping lifecycle: what `forget_chat` must reclaim so a
//! long-lived connection does not accumulate per-chat state for chats that
//! ended.

use super::*;

fn connection() -> (FacadeConnection, mpsc::UnboundedReceiver<String>) {
    let (tx, rx) = mpsc::unbounded_channel();
    (FacadeConnection::new("mock-cli".to_string(), tx), rx)
}

#[test]
fn forget_chat_keeps_the_same_lock_while_a_prompt_is_in_flight() {
    let (connection, _rx) = connection();
    let in_flight = connection.session_prompt_lock("chat-1");
    let held = in_flight.try_lock().unwrap();
    connection.forget_chat("chat-1");
    let next = connection.session_prompt_lock("chat-1");
    assert!(Arc::ptr_eq(&in_flight, &next));
    assert!(next.try_lock().is_err());
    drop(held);
    assert!(next.try_lock().is_ok());
}

/// Spend this task's cooperative-scheduling budget without yielding: every
/// ready `consume_budget` poll burns one unit, and the first `Pending` means
/// the budget is gone.
fn exhaust_coop_budget() {
    let mut cx = std::task::Context::from_waker(std::task::Waker::noop());
    for _ in 0..1024 {
        let mut consume = Box::pin(tokio::task::coop::consume_budget());
        if consume.as_mut().poll(&mut cx).is_pending() {
            return;
        }
    }
    panic!("coop budget never ran out");
}

/// `Acquire::poll` runs the coop check BEFORE it touches the semaphore, so on
/// a task with no budget left an unconstrained-less `lock_owned()` reports
/// `Pending` without registering a waiter — "queued" with no place taken,
/// which is exactly the race `enqueue_prompt_lock` exists to remove. A
/// replay burst drains `outbound.recv()` without yielding, so budget 0 is
/// reachable on the socket loop.
#[tokio::test]
async fn a_lock_queued_with_no_coop_budget_still_takes_its_place() {
    let (connection, _rx) = connection();
    let connection = Arc::new(connection);
    let held = connection.session_prompt_lock("chat-1").lock_owned().await;

    exhaust_coop_budget();
    assert!(
        !tokio::task::coop::has_budget_remaining(),
        "the case under test needs a task whose coop budget is spent"
    );
    let wait = connection.enqueue_prompt_lock("chat-1");
    assert!(
        matches!(wait, SessionLockWait::Queued(_)),
        "a held lock cannot be acquired on the spot"
    );

    let order = Arc::new(std::sync::Mutex::new(Vec::new()));
    let (first, second) = (Arc::clone(&order), Arc::clone(&order));

    // The later arrival polls first: only a waiter registered by the enqueue
    // above can keep it behind.
    let later = connection.session_prompt_lock("chat-1");
    let latecomer = tokio::spawn(async move {
        let _guard = later.lock_owned().await;
        second.lock().unwrap().push("later");
    });
    tokio::task::yield_now().await;
    let queued = tokio::spawn(async move {
        let _guard = wait.guard().await;
        first.lock().unwrap().push("queued");
    });
    tokio::task::yield_now().await;

    drop(held);
    queued.await.unwrap();
    latecomer.await.unwrap();

    assert_eq!(*order.lock().unwrap(), vec!["queued", "later"]);
}
