//! Idle whole-chat offload (todo #178): the full release sequence the scanner
//! (`idle_scanner.rs`) drives per candidate. Not a port of any TS file — the
//! old scanner only killed the CLI process; this extends that into "release
//! the chat as one unit" (plan
//! `docs/plans/2026-09-25-todo-178-idle-whole-chat-offload.md`, "Design").
//!
//! "Offloaded" stores no new state: after step 4 the chat has no registry
//! cell and no cache entry, so the next `load_chat` reloads its transcript
//! fresh (the existing cold-load path) and the next `send_message` respawns
//! via `--resume`.

use std::sync::{Arc, Mutex};

use mainframe_adapter_api::{AdapterSession, BoxFuture};
use mainframe_types::chat::QueuedMessageRef;
use mainframe_types::events::DaemonEvent;
use tracing::{info, warn};

use crate::event_handler::{EventHandler, EventHandlerDeps};
use crate::idle_scanner::{ActiveChatRegistry, IDLE_THRESHOLD_MS, IdleOffloader};
use crate::lifecycle_manager::{ChatLifecycleManager, LifecycleManagerDeps};
use crate::message_cache::MessageCache;
use crate::permission_manager::PermissionManager;

/// The offload sequence for one `ChatManager` (Design steps 1-6), built once
/// from the same shared `Arc`s the manager already holds (registry, cache,
/// permissions, queued refs, lifecycle, event handler) and stored as a trait
/// object so `IdleSessionScanner`'s periodic task needs no `Weak<ChatManager>`.
pub struct ChatOffload<L: LifecycleManagerDeps + 'static, E: EventHandlerDeps + 'static> {
    active_chats: ActiveChatRegistry,
    messages: Arc<Mutex<MessageCache>>,
    permissions: Arc<Mutex<PermissionManager>>,
    queued_refs: Arc<Mutex<Vec<QueuedMessageRef>>>,
    lifecycle: Arc<ChatLifecycleManager<L>>,
    event_handler: Arc<EventHandler<E>>,
    threshold_ms: i64,
}

impl<L: LifecycleManagerDeps + 'static, E: EventHandlerDeps + 'static> ChatOffload<L, E> {
    pub fn new(
        active_chats: ActiveChatRegistry,
        messages: Arc<Mutex<MessageCache>>,
        permissions: Arc<Mutex<PermissionManager>>,
        queued_refs: Arc<Mutex<Vec<QueuedMessageRef>>>,
        lifecycle: Arc<ChatLifecycleManager<L>>,
        event_handler: Arc<EventHandler<E>>,
    ) -> Self {
        Self::with_threshold(
            active_chats,
            messages,
            permissions,
            queued_refs,
            lifecycle,
            event_handler,
            IDLE_THRESHOLD_MS,
        )
    }

    /// Test seam: a chat idle relative to the real wall clock past a tiny
    /// threshold behaves exactly like a chat idle 2+ hours past the real one,
    /// so tests inject a small threshold rather than a fake clock.
    pub fn with_threshold(
        active_chats: ActiveChatRegistry,
        messages: Arc<Mutex<MessageCache>>,
        permissions: Arc<Mutex<PermissionManager>>,
        queued_refs: Arc<Mutex<Vec<QueuedMessageRef>>>,
        lifecycle: Arc<ChatLifecycleManager<L>>,
        event_handler: Arc<EventHandler<E>>,
        threshold_ms: i64,
    ) -> Self {
        Self {
            active_chats,
            messages,
            permissions,
            queued_refs,
            lifecycle,
            event_handler,
            threshold_ms,
        }
    }

    async fn try_offload(&self, chat_id: &str) {
        // Step 1: claim the offload slot, or skip — a concurrent load/start/
        // send/interrupt/history-read (or a second scan pass, AC5) already
        // owns this chat.
        if !self.lifecycle.try_claim_offload(chat_id) {
            return;
        }

        // Step 2: re-check everything now that the slot is claimed (AC4: a
        // race between candidate selection and this claim must resolve in
        // favor of staying live).
        let Some(session) = self.recheck(chat_id) else {
            self.lifecycle.release_offload(chat_id);
            return;
        };

        // Step 3: kill the CLI process.
        if let Err(err) = session.kill().await {
            warn!(?err, chat_id, "idle offload: failed to kill session");
        }

        // Step 4: drop the registry cell, the cache entry, and per-chat
        // bookkeeping (partial-overlay + permission state). Do NOT emit
        // `ChatEnded` here (Design): that would tell the chat surface a
        // possibly-on-screen chat's facade session ended.
        self.active_chats.remove(chat_id);
        self.messages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .delete(chat_id);
        self.event_handler.clear_display_state(chat_id);
        self.permissions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .forget(chat_id);

        // Step 5: release the slot.
        self.lifecycle.release_offload(chat_id);

        // Step 6: broadcast.
        info!(chat_id, "idle offload: released chat");
        self.lifecycle.emit_event(DaemonEvent::ChatOffloaded {
            chat_id: chat_id.to_string(),
        });
    }

    /// Step 2's re-check. `Some(session)` when every condition still holds
    /// (spawned, idle past the threshold, no pending permission, no queued
    /// message); `None` means skip — the caller has already claimed the
    /// offload slot and must release it itself.
    fn recheck(&self, chat_id: &str) -> Option<Arc<dyn AdapterSession>> {
        let cell = self.active_chats.get(chat_id)?.value().clone();
        let session = {
            let guard = cell.lock().unwrap_or_else(|e| e.into_inner());
            guard.session.clone()?
        };
        if !session.is_spawned() {
            return None;
        }
        let last = session.last_activity_at()?;
        if now_ms() - last <= self.threshold_ms {
            return None;
        }
        if self
            .permissions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .has_pending(chat_id)
        {
            return None;
        }
        let has_queued = self
            .queued_refs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .any(|r| r.chat_id == chat_id);
        if has_queued {
            return None;
        }
        Some(session)
    }
}

impl<L, E> IdleOffloader for ChatOffload<L, E>
where
    L: LifecycleManagerDeps + 'static,
    E: EventHandlerDeps + 'static,
{
    fn offload<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(self.try_offload(chat_id))
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
