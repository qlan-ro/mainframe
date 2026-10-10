#![allow(clippy::unwrap_used, clippy::expect_used)]
use mainframe_db::{DbError, actor::SqliteActor};
use std::{cell::Cell, rc::Rc, sync::mpsc};

#[tokio::test]
async fn non_send_state_stays_on_one_thread_and_mutations_are_ordered() {
    let actor = SqliteActor::<Rc<Cell<i32>>>::spawn(|| Ok(Rc::new(Cell::new(0)))).unwrap();
    let caller = std::thread::current().id();
    let worker = actor
        .call(move |state| {
            state.set(7);
            Ok(std::thread::current().id())
        })
        .await
        .unwrap();
    assert_ne!(worker, caller);
    assert_eq!(actor.call(|state| Ok(state.get())).await.unwrap(), 7);
    assert_eq!(
        actor
            .call_blocking(|_| Ok(std::thread::current().id()))
            .unwrap(),
        worker
    );
}

#[tokio::test]
async fn cancelling_the_waiter_does_not_cancel_an_accepted_write() {
    let actor = SqliteActor::<i32>::spawn(|| Ok(0)).unwrap();
    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let handle = actor.clone();
    let waiter = tokio::spawn(async move {
        handle
            .call_mut(move |state| {
                started_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                *state = 41;
                Ok(())
            })
            .await
    });
    started_rx.await.unwrap();
    waiter.abort();
    release_tx.send(()).unwrap();
    assert_eq!(actor.call(|state| Ok(*state)).await.unwrap(), 41);
}

#[test]
fn opening_errors_keep_the_original_message() {
    let result = SqliteActor::<()>::spawn(|| Err(DbError::Message("open failed".into())));
    assert_eq!(result.err().unwrap().to_string(), "open failed");
}
