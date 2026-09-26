//! Offload/send/history single-flight claims (todo #178). A child module of
//! `lifecycle_manager` so it can reach the private `Guards`/`Flight`/
//! `join_flight` machinery without making any of it crate-visible.
//!
//! Every method here is `pub(crate)`: only `chat_manager` (this crate's other
//! module) and `idle_offload` call them. `SendGuard`'s return type must match
//! that visibility exactly, or rustc's `private_interfaces` lint would flag a
//! `pub` fn leaking a less-visible type — see the module docs on `SendGuard`.

use super::*;

impl<D: LifecycleManagerDeps + 'static> ChatLifecycleManager<D> {
    /// Step 1 of the offload sequence (plan "Design"): claim the offload slot
    /// for `chat_id`, or refuse when the chat has any loading, starting,
    /// interrupting, history, or send activity, or an offload already claimed
    /// it. The check and the claim happen in the SAME critical section so a
    /// concurrent `begin_send`/`load_chat`/etc. can't slip in between them.
    pub(crate) fn try_claim_offload(&self, chat_id: &str) -> bool {
        let mut g = self.guards.lock().unwrap_or_else(|e| e.into_inner());
        let busy = g.loading.contains_key(chat_id)
            || g.starting.contains_key(chat_id)
            || g.interrupting.contains_key(chat_id)
            || g.history.contains_key(chat_id)
            || g.sending.get(chat_id).copied().unwrap_or(0) > 0
            || g.offloading.contains_key(chat_id);
        if busy {
            return false;
        }
        g.offloading
            .insert(chat_id.to_string(), Arc::new(Notify::new()));
        true
    }

    /// Step 5: release a claimed offload slot and wake anything waiting on it
    /// (`await_offload`/`begin_send`).
    pub(crate) fn release_offload(&self, chat_id: &str) {
        let notify = self
            .guards
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .offloading
            .remove(chat_id);
        if let Some(n) = notify {
            n.notify_waiters();
        }
    }

    /// Wait out an in-flight offload before reading registry/cache state
    /// (`load_chat`, `start_chat`, `get_messages`).
    pub(crate) async fn await_offload(&self, chat_id: &str) {
        let n = self
            .guards
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .offloading
            .get(chat_id)
            .cloned();
        if let Some(n) = n {
            join_flight(&self.guards, n, |g| g.offloading.get(chat_id)).await;
        }
    }

    /// Register an in-flight send for `chat_id`. Waits out any offload
    /// already in flight, then registers, re-looping if a fresh offload won
    /// the race in between — so the returned guard's registration is always
    /// visible to `try_claim_offload`'s busy check (or this call waited for
    /// that offload to finish first).
    pub(crate) async fn begin_send(self: &Arc<Self>, chat_id: &str) -> SendGuard<D> {
        loop {
            let waiting = {
                let mut g = self.guards.lock().unwrap_or_else(|e| e.into_inner());
                match g.offloading.get(chat_id).cloned() {
                    Some(n) => Some(n),
                    None => {
                        *g.sending.entry(chat_id.to_string()).or_insert(0) += 1;
                        None
                    }
                }
            };
            match waiting {
                Some(n) => join_flight(&self.guards, n, |g| g.offloading.get(chat_id)).await,
                None => {
                    return SendGuard {
                        lifecycle: self.clone(),
                        chat_id: chat_id.to_string(),
                    };
                }
            }
        }
    }

    fn end_send(&self, chat_id: &str) {
        let mut g = self.guards.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(count) = g.sending.get_mut(chat_id) {
            *count -= 1;
            if *count == 0 {
                g.sending.remove(chat_id);
            }
        }
    }

    /// Single-flight the on-disk transcript read behind `get_messages`.
    /// `true` means the caller must perform the read itself and MUST call
    /// [`Self::release_history`] when done (success or failure); `false`
    /// means another read for this chat already finished while this call
    /// waited, so the caller should re-check the cache instead of hitting
    /// disk again.
    pub(crate) async fn claim_history(&self, chat_id: &str) -> bool {
        let action = {
            let mut g = self.guards.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(existing) = g.history.get(chat_id).cloned() {
                Flight::Await(existing)
            } else {
                let n = Arc::new(Notify::new());
                g.history.insert(chat_id.to_string(), n.clone());
                Flight::Claimed(n)
            }
        };
        match action {
            Flight::Await(existing) => {
                join_flight(&self.guards, existing, |g| g.history.get(chat_id)).await;
                false
            }
            Flight::Skip => unreachable!("claim_history's Guards check never yields Skip"),
            Flight::Claimed(_) => true,
        }
    }

    pub(crate) fn release_history(&self, chat_id: &str) {
        let notify = self
            .guards
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .history
            .remove(chat_id);
        if let Some(n) = notify {
            n.notify_waiters();
        }
    }

    /// Pass-through to the injected `emit_event` (already enrich-on-emit for
    /// `ChatUpdated`/`ChatCreated`; a no-op enrichment for anything else,
    /// including `ChatOffloaded`) — lets `idle_offload` broadcast without
    /// needing its own copy of `deps`.
    pub(crate) fn emit_event(&self, event: DaemonEvent) {
        self.deps.emit_event(event);
    }
}

/// RAII send registration (`ChatLifecycleManager::begin_send`): decrements the
/// in-flight count on drop so an early return (`?`, the worktree-missing
/// early-out in `send_message`) can't leak the count and permanently block
/// offload for that chat.
pub(crate) struct SendGuard<D: LifecycleManagerDeps + 'static> {
    lifecycle: Arc<ChatLifecycleManager<D>>,
    chat_id: String,
}

impl<D: LifecycleManagerDeps + 'static> Drop for SendGuard<D> {
    fn drop(&mut self) {
        self.lifecycle.end_send(&self.chat_id);
    }
}

#[cfg(test)]
mod tests {
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
        assert!(!mgr.try_claim_offload("c1"));
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
        {
            let mut g = mgr.guards.lock().unwrap();
            g.loading
                .insert("c1".to_string(), Arc::new(tokio::sync::Notify::new()));
        }
        assert!(!mgr.try_claim_offload("c1"));
    }

    /// AC4's "in-flight spawn" case — see the loading test's doc for why this
    /// is asserted at the guard level (`guards.starting`) rather than through
    /// a live `start_chat` call.
    #[test]
    fn try_claim_offload_refuses_while_a_spawn_is_in_flight() {
        let mgr = manager();
        {
            let mut g = mgr.guards.lock().unwrap();
            g.starting
                .insert("c1".to_string(), Arc::new(tokio::sync::Notify::new()));
        }
        assert!(!mgr.try_claim_offload("c1"));
    }

    #[test]
    fn try_claim_offload_refuses_a_second_concurrent_claim() {
        let mgr = manager();
        assert!(mgr.try_claim_offload("c1"));
        assert!(!mgr.try_claim_offload("c1"));
        mgr.release_offload("c1");
        assert!(mgr.try_claim_offload("c1"));
    }

    #[tokio::test]
    async fn begin_send_waits_for_an_in_flight_offload_then_registers() {
        let mgr = manager();
        assert!(mgr.try_claim_offload("c1"));

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
        mgr.release_offload("c1");
        waiter.await.unwrap();
    }

    #[tokio::test]
    async fn send_guard_drop_unblocks_a_later_offload_claim() {
        let mgr = manager();
        let guard = mgr.begin_send("c1").await;
        assert!(
            !mgr.try_claim_offload("c1"),
            "a live send must block a fresh offload claim"
        );
        drop(guard);
        assert!(mgr.try_claim_offload("c1"));
    }

    #[tokio::test]
    async fn claim_history_single_flights_concurrent_readers() {
        let mgr = manager();
        assert!(mgr.claim_history("c1").await, "first caller leads");

        let follower = {
            let mgr = mgr.clone();
            tokio::spawn(async move { mgr.claim_history("c1").await })
        };
        tokio::task::yield_now().await;
        mgr.release_history("c1");
        assert!(!follower.await.unwrap(), "second caller follows, not leads");
    }
}
