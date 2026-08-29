//! `ChatManager` construction and top-level lifecycle plumbing.
use super::*;

/// The five sub-manager collaborators, built in dependency order (offers →
/// event handler → lifecycle → permission handler → config) so `new` stays a
/// straight read of the assembled bundle.
struct Collaborators {
    event_handler: Arc<EventHandler<EhDeps>>,
    lifecycle: Arc<ChatLifecycleManager<LcDeps>>,
    permission_handler: ChatPermissionHandler<PhDeps>,
    config: ChatConfigManager<CmDeps>,
    worktree_offers: Arc<WorktreeOfferRegistry>,
}

impl Collaborators {
    fn build(
        deps: &Arc<dyn ChatManagerDeps>,
        active_chats: &Registry,
        messages: &Arc<Mutex<MessageCache>>,
        permissions: &Arc<Mutex<PermissionManager>>,
        queued_refs: &QueuedRefs,
        self_ref: &Arc<std::sync::OnceLock<std::sync::Weak<ChatManager>>>,
    ) -> Self {
        let worktree_offers = deps_offer::build(deps, active_chats, permissions);
        let event_handler = deps_event::build(
            deps,
            active_chats,
            messages,
            permissions,
            queued_refs,
            &worktree_offers,
        );
        let lifecycle = deps_lifecycle::build(
            deps,
            active_chats,
            messages,
            permissions,
            &event_handler,
            &worktree_offers,
        );
        let permission_handler = deps_permission::build(
            deps,
            active_chats,
            messages,
            permissions,
            &event_handler,
            &lifecycle,
            self_ref,
        );
        let config = deps_config::build(
            deps,
            active_chats,
            permissions,
            &lifecycle,
            &worktree_offers,
        );
        Self {
            event_handler,
            lifecycle,
            permission_handler,
            config,
            worktree_offers,
        }
    }
}

impl ChatManager {
    pub fn new(deps: Arc<dyn ChatManagerDeps>) -> Self {
        let active_chats: Registry = Arc::new(DashMap::new());
        let messages = Arc::new(Mutex::new(MessageCache::new()));
        let permissions = Arc::new(Mutex::new(PermissionManager::new()));
        let queued_refs: QueuedRefs = Arc::new(Mutex::new(Vec::new()));

        // Unset until `attach_self()` runs (called from `build_chat_manager` once
        // the manager is behind an `Arc`); until then plan-mode's clear-context
        // follow-up send fails closed with a warning rather than silently no-oping.
        let self_ref: Arc<std::sync::OnceLock<std::sync::Weak<ChatManager>>> =
            Arc::new(std::sync::OnceLock::new());

        let collab = Collaborators::build(
            &deps,
            &active_chats,
            &messages,
            &permissions,
            &queued_refs,
            &self_ref,
        );

        let mut idle_scanner = crate::idle_scanner::IdleSessionScanner::new(active_chats.clone());
        idle_scanner.start();

        Self {
            deps,
            active_chats,
            messages,
            permissions,
            queued_refs,
            event_handler: collab.event_handler,
            lifecycle: collab.lifecycle,
            permission_handler: collab.permission_handler,
            config: collab.config,
            idle_scanner: Mutex::new(idle_scanner),
            external_sessions: None,
            worktree_offers: collab.worktree_offers,
            self_ref,
        }
    }

    /// Inject the `ExternalSessionService` built from the concrete deps type
    /// (`getExternalSessionService()`'s backing instance). Called once at boot,
    /// before the manager is shared behind an `Arc`.
    pub fn with_external_sessions(mut self, service: Arc<dyn ExternalSessionFacade>) -> Self {
        self.external_sessions = Some(service);
        self
    }

    /// Attach the chat-surface observer (todo #350 plan task 10) both the
    /// legacy WS surface and the ACP facade can be driven from. A manager
    /// built with none attached (most tests) behaves exactly as before —
    /// `EventHandler::notify_chat_surface` is a no-op until this runs.
    /// `permission_handler` gets the same surface (plan task 17): it owns
    /// the normal permission-answer path, which `EventHandler` never sees.
    pub fn with_chat_surface(self, surface: Arc<dyn crate::chat_surface::ChatSurface>) -> Self {
        self.event_handler.set_chat_surface(surface.clone());
        self.permission_handler.set_chat_surface(surface);
        self
    }

    /// Lets `PlanHostImpl::send_message` reach back into this manager for the
    /// clear-context follow-up send. Must run once, after the manager is behind
    /// an `Arc` (can't use `Arc::new_cyclic` without touching every `ChatManager::new`
    /// call site); idempotent, so a second call is a harmless no-op.
    pub fn attach_self(self: &Arc<Self>) {
        let _ = self.self_ref.set(Arc::downgrade(self));
    }

    /// `ctx.chats.getExternalSessionService()` — `None` when the manager was
    /// built without one (e.g. a test harness that only needs the rest of the
    /// facade).
    pub fn external_session_service(&self) -> Option<Arc<dyn ExternalSessionFacade>> {
        self.external_sessions.clone()
    }

    pub(super) fn emit(&self, event: DaemonEvent) {
        enrich_and_emit(self.deps.as_ref(), &self.permissions, event);
    }

    pub(super) fn get_active(&self, chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        self.active_chats.get(chat_id).map(|e| e.value().clone())
    }

    /// A turn is in flight. Reads the live cell, not the DB row — the row lags
    /// behind by one write.
    pub(super) fn is_chat_working(&self, chat_id: &str) -> bool {
        self.get_active(chat_id)
            .is_some_and(|cell| is_working(&cell.lock().unwrap_or_else(|e| e.into_inner()).chat))
    }

    /// On boot: reset orphaned `processState: 'working'` chats to idle.
    pub fn recover_stale_working_state(&self) {
        let count = self.deps.chats_reset_working_to_idle();
        info!(count, "reset orphaned working chats to idle on boot");
    }

    /// Stop background timers. Idempotent.
    pub fn dispose(&self) {
        self.idle_scanner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .stop();
    }

    /// Exposed for tests — runs one idle-eviction pass immediately. The scanner
    /// reads the shared registry, so a transient scanner over the same registry is
    /// equivalent to the stored one (avoids holding the scanner Mutex across await).
    pub async fn scan_idle_sessions(&self) {
        crate::idle_scanner::IdleSessionScanner::new(self.active_chats.clone())
            .scan()
            .await;
    }
}
