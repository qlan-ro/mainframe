//! Offload/send/history single-flight claims. A child module of
//! `lifecycle_manager` so it can reach the private
//! `Guards`/`Flight` machinery without making any of it
//! crate-visible.
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
    pub(crate) fn try_claim_offload(&self, chat_id: &str) -> Option<FlightClaim> {
        let g = self.guards.lock_recover();
        let busy = g.loading.contains_key(chat_id)
            || g.starting.contains_key(chat_id)
            || g.interrupting.contains_key(chat_id)
            || g.history.contains_key(chat_id)
            || g.sending.get(chat_id).copied().unwrap_or(0) > 0;
        if busy {
            return None;
        }
        g.offloading.claim(chat_id).ok()
    }

    /// Wait out an in-flight offload before reading registry/cache state
    /// (`load_chat`, `start_chat`, `get_messages`).
    pub(crate) async fn await_offload(&self, chat_id: &str) {
        let n = self.guards.lock_recover().offloading.get(chat_id);
        if let Some(n) = n {
            n.wait().await;
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
                let mut g = self.guards.lock_recover();
                match g.offloading.get(chat_id) {
                    Some(n) => Some(n),
                    None => {
                        *g.sending.entry(chat_id.to_string()).or_insert(0) += 1;
                        None
                    }
                }
            };
            match waiting {
                Some(n) => n.wait().await,
                None => {
                    // Registering a send is a use.
                    self.touch(chat_id);
                    return SendGuard {
                        lifecycle: self.clone(),
                        chat_id: chat_id.to_string(),
                    };
                }
            }
        }
    }

    fn end_send(&self, chat_id: &str) {
        // A send ending is also a use: without this, a long turn whose
        // `begin_send` registration predates the idle threshold would look idle
        // the instant the guard drops.
        self.touch(chat_id);
        let mut g = self.guards.lock_recover();
        if let Some(count) = g.sending.get_mut(chat_id) {
            *count -= 1;
            if *count == 0 {
                g.sending.remove(chat_id);
            }
        }
    }

    /// The owner holds the claim through the disk read; followers recheck cache.
    pub(crate) async fn claim_history(&self, chat_id: &str) -> Option<FlightClaim> {
        let claim = self.guards.lock_recover().history.claim(chat_id);
        match claim {
            Ok(claim) => Some(claim),
            Err(waiter) => {
                waiter.wait().await;
                None
            }
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
#[path = "flight_claims_tests.rs"]
mod tests;
