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
use crate::idle_scanner::{ActiveChatRegistry, IDLE_THRESHOLD_MS, IdleOffloader, idle_since};
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
        // favor of staying live). `session_handle` is itself an `Option`
        // (todo #381): a session-less, never-spawned, or already-exited
        // handle is a valid, eligible offload — only the OUTER `None` means
        // "skip".
        let Some(session_handle) = self.recheck(chat_id) else {
            self.lifecycle.release_offload(chat_id);
            return;
        };

        // Step 3: kill the CLI process, if one was ever spawned. Harmless
        // no-op on an unspawned/already-exited handle (Established facts:
        // `ClaudeSession::kill`/Codex `kill` both return `Ok` with no child).
        if let Some(session) = &session_handle
            && let Err(err) = session.kill().await
        {
            warn!(?err, chat_id, "idle offload: failed to kill session");
        }
        self.lifecycle.orchestration().revoke(chat_id);

        // Step 4: drop the registry cell, the cache entry, and per-chat
        // bookkeeping (partial-overlay + permission state). Do NOT emit
        // `ChatEnded` here (Design): that would tell the chat surface a
        // possibly-on-screen chat's facade session ended.
        self.active_chats.remove(chat_id);
        self.messages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .release(chat_id);
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

    /// Step 2's re-check (todo #381: extended to session-less/unspawned
    /// cells). The OUTER `Option` is the skip signal: `None` means some
    /// condition still blocks offload, and the caller has already claimed
    /// the offload slot and must release it itself. `Some(handle)` means
    /// every condition holds (idle past the threshold per `idle_since`, not
    /// Working, no pending permission, no queued message); `handle` itself
    /// is `None` for a cell with no session (or one that never spawned) —
    /// that is a valid, eligible offload, not a skip.
    fn recheck(&self, chat_id: &str) -> Option<Option<Arc<dyn AdapterSession>>> {
        let cell = self.active_chats.get(chat_id)?.value().clone();
        let (session, last_used_at, process_state) = {
            let guard = cell.lock().unwrap_or_else(|e| e.into_inner());
            (
                guard.session.clone(),
                guard.last_used_at,
                guard.chat.process_state,
            )
        };
        // A turn whose tool runs silent past the idle threshold must not have
        // its CLI killed mid-turn (finding 4): `is_spawned`/`last_activity_at`
        // alone can't see that, since a long tool call produces no adapter
        // activity. This still applies to a session-less cell in the rare
        // case its persisted `process_state` is Working (e.g. a REST resume
        // held by a pending gate) — the acceptance criteria require it.
        if process_state == Some(Some(mainframe_types::chat::ProcessState::Working)) {
            return None;
        }
        let last = idle_since(session.as_ref(), last_used_at)?;
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
