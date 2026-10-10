use super::*;
use crate::lifecycle_manager::tests::FakeDeps;
use crate::message_cache::MessageCache;
use crate::permission_manager::PermissionManager;
use crate::test_support::test_chat;
use std::sync::Mutex;

/// The claim/release/single-flight machinery here never reaches `deps`
/// (it only touches `Guards`), so the archive-chat suite's `FakeDeps` — a
/// working `LifecycleManagerDeps` already in this module tree — is reused
/// as-is rather than hand-rolling a second trait impl.
fn manager() -> Arc<ChatLifecycleManager<FakeDeps>> {
    Arc::new(ChatLifecycleManager::new(
        FakeDeps::new(test_chat("c1"), Vec::new()),
        Arc::new(DashMap::new()),
        Arc::new(Mutex::new(MessageCache::new())),
        Arc::new(Mutex::new(PermissionManager::new())),
    ))
}

#[test]
fn try_claim_offload_refuses_while_a_send_is_registered() {
    let mgr = manager();
    // No async needed: `begin_send`'s registration critical section runs
    // synchronously when no offload is in flight, so a blocking claim
    // suffices to assert the busy check.
    {
        let mut g = mgr.guards.lock().unwrap();
        g.sending.insert("c1".to_string(), 1);
    }
    assert!(mgr.try_claim_offload("c1").is_none());
}

/// AC4's "in-flight load" case: `load_chat`'s own single-flight claim
/// (`guards.loading`) is one of `try_claim_offload`'s busy conditions —
/// this asserts that condition directly, the same way the send case
/// above asserts `guards.sending`. (`chat_manager::tests::offload`'s
/// AC4 suite drives the OTHER two race conditions — permission and
/// activity — end to end through a live `ChatManager`; a genuine
/// in-flight `guards.loading`/`guards.starting` claim can't arise for a
/// chat that's already an active, spawned idle candidate, since
/// `load_chat`/`start_chat` both skip claiming for exactly that chat
/// state — so this is asserted at the guard level instead.)
#[test]
fn try_claim_offload_refuses_while_a_load_is_in_flight() {
    let mgr = manager();
    let _claim = mgr.guards.lock().unwrap().loading.claim("c1").unwrap();
    assert!(mgr.try_claim_offload("c1").is_none());
}

/// AC4's "in-flight spawn" case — see the loading test's doc for why this
/// is asserted at the guard level (`guards.starting`) rather than through
/// a live `start_chat` call.
#[test]
fn try_claim_offload_refuses_while_a_spawn_is_in_flight() {
    let mgr = manager();
    let _claim = mgr.guards.lock().unwrap().starting.claim("c1").unwrap();
    assert!(mgr.try_claim_offload("c1").is_none());
}

#[test]
fn try_claim_offload_refuses_a_second_concurrent_claim() {
    let mgr = manager();
    let claim = mgr.try_claim_offload("c1").unwrap();
    assert!(mgr.try_claim_offload("c1").is_none());
    drop(claim);
    let _claim = mgr.try_claim_offload("c1").unwrap();
}

#[tokio::test]
async fn begin_send_waits_for_an_in_flight_offload_then_registers() {
    let mgr = manager();
    let claim = mgr.try_claim_offload("c1").unwrap();

    let waiter = {
        let mgr = mgr.clone();
        tokio::spawn(async move {
            let _guard = mgr.begin_send("c1").await;
        })
    };

    tokio::task::yield_now().await;
    assert!(
        !waiter.is_finished(),
        "begin_send must wait for the in-flight offload"
    );
    drop(claim);
    waiter.await.unwrap();
}

#[tokio::test]
async fn send_guard_drop_unblocks_a_later_offload_claim() {
    let mgr = manager();
    let guard = mgr.begin_send("c1").await;
    assert!(
        mgr.try_claim_offload("c1").is_none(),
        "a live send must block a fresh offload claim"
    );
    drop(guard);
    let _claim = mgr.try_claim_offload("c1").unwrap();
}

#[tokio::test]
async fn claim_history_single_flights_concurrent_readers() {
    let mgr = manager();
    let claim = mgr.claim_history("c1").await.unwrap();

    let follower = {
        let mgr = mgr.clone();
        tokio::spawn(async move { mgr.claim_history("c1").await })
    };
    tokio::task::yield_now().await;
    drop(claim);
    assert!(
        follower.await.unwrap().is_none(),
        "second caller follows, not leads"
    );
}
