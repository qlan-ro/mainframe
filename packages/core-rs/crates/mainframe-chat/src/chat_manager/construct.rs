//! `ChatManager` construction and top-level lifecycle plumbing.
use super::*;
use mainframe_types::sync::LockExt as _;

/// The five sub-manager collaborators, built in dependency order (offers →
/// event handler → lifecycle → permission handler → config) so `new` stays a
/// straight read of the assembled bundle.
pub(crate) struct Collaborators {
    pub(crate) event_handler: Arc<EventHandler>,
    pub(crate) lifecycle: Arc<ChatLifecycleManager>,
    pub(crate) permission_handler: ChatPermissionHandler,
    pub(super) config: ChatConfigManager,
    pub(crate) worktree_offers: Arc<WorktreeOfferRegistry>,
}

impl Collaborators {
    pub(crate) fn build(
        shared: &Arc<ChatShared>,
        self_ref: &Arc<std::sync::OnceLock<std::sync::Weak<ChatManager>>>,
    ) -> Self {
        let worktree_offers = Arc::new(WorktreeOfferRegistry::new(shared.clone()));
        let event_handler = Arc::new(EventHandler::new(shared.clone(), worktree_offers.clone()));
        let lifecycle = Arc::new(ChatLifecycleManager::new(
            shared.clone(),
            event_handler.clone(),
            worktree_offers.clone(),
        ));
        let permission_handler = plan_host::build(shared, &event_handler, &lifecycle, self_ref);
        let config =
            ChatConfigManager::new(shared.clone(), lifecycle.clone(), worktree_offers.clone());
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
        let shared = ChatShared::new(deps);

        // Unset until `attach_self()` runs (called from `build_chat_manager` once
        // the manager is behind an `Arc`); until then plan-mode's clear-context
        // follow-up send fails closed with a warning rather than silently no-oping.
        let self_ref: Arc<std::sync::OnceLock<std::sync::Weak<ChatManager>>> =
            Arc::new(std::sync::OnceLock::new());

        let collab = Collaborators::build(&shared, &self_ref);

        let teardown = Arc::new(crate::chat_teardown::ChatTeardown {
            active_chats: shared.active_chats.clone(),
            messages: shared.messages.clone(),
            permissions: shared.permissions.clone(),
            worktree_offers: collab.worktree_offers.clone(),
            event_handler: collab.event_handler.clone(),
        });

        let offloader: Arc<dyn crate::idle_scanner::IdleOffloader> =
            Arc::new(crate::idle_offload::ChatOffload::new(
                shared.active_chats.clone(),
                shared.permissions.clone(),
                shared.queued_refs.clone(),
                collab.lifecycle.clone(),
                teardown.clone(),
            ));
        let mut idle_scanner =
            crate::idle_scanner::IdleSessionScanner::new(shared.active_chats.clone(), offloader);
        idle_scanner.start();

        let history_cache = Arc::new(HistorySnapshotCache::new(std::path::PathBuf::from(
            shared.deps.history_cache_dir(),
        )));

        Self {
            shared,
            event_handler: collab.event_handler,
            lifecycle: collab.lifecycle,
            permission_handler: collab.permission_handler,
            config: collab.config,
            idle_scanner: Mutex::new(idle_scanner),
            external_sessions: None,
            worktree_offers: collab.worktree_offers,
            self_ref,
            history_cache,
            handoff_locks: mainframe_runtime::sync::KeyedMutex::default(),
            teardown,
        }
    }

    /// Build external-session scans over the manager's shared chat state.
    pub fn with_external_sessions<D: ExternalSessionDeps + 'static>(
        mut self,
        deps: Arc<D>,
    ) -> Self {
        self.external_sessions = Some(Arc::new(ExternalSessionService::new(
            deps,
            self.shared.clone(),
        )));
        self
    }

    /// Attach the chat-surface observer (the ACP facade hub). A manager built
    /// with none attached (most tests) emits no surface events —
    /// `EventHandler::notify_chat_surface` is a no-op until this runs.
    /// `permission_handler` gets the same surface: it owns the normal
    /// permission-answer path, which `EventHandler` never sees.
    pub fn with_chat_surface(self, surface: Arc<dyn crate::chat_surface::ChatSurface>) -> Self {
        self.event_handler.set_chat_surface(surface.clone());
        self.permission_handler.set_chat_surface(surface.clone());
        self.lifecycle.set_chat_surface(surface);
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
        self.shared.emit(event);
    }

    pub(super) fn get_active(&self, chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        self.shared
            .active_chats
            .get(chat_id)
            .map(|e| e.value().clone())
    }

    /// A turn is in flight. Reads the live cell, not the DB row — the row lags
    /// behind by one write.
    pub fn is_chat_working(&self, chat_id: &str) -> bool {
        self.get_active(chat_id)
            .is_some_and(|cell| is_working(&cell.lock_recover().chat))
    }

    /// On boot: reset orphaned `processState: 'working'` chats to idle.
    pub fn recover_stale_working_state(&self) {
        let count = storage_event!(self.shared, self.shared.deps.chats_reset_working_to_idle());
        info!(count, "reset orphaned working chats to idle on boot");
    }

    /// Stop background timers. Idempotent.
    pub fn dispose(&self) {
        self.idle_scanner.lock_recover().stop();
    }

    /// Exposed for tests — runs one idle-eviction pass immediately. The scanner
    /// reads the shared registry, so a transient scanner over the same registry is
    /// equivalent to the stored one (avoids holding the scanner Mutex across await).
    pub async fn scan_idle_sessions(&self) {
        let offloader: Arc<dyn crate::idle_scanner::IdleOffloader> =
            Arc::new(crate::idle_offload::ChatOffload::new(
                self.shared.active_chats.clone(),
                self.shared.permissions.clone(),
                self.shared.queued_refs.clone(),
                self.lifecycle.clone(),
                self.teardown.clone(),
            ));
        crate::idle_scanner::IdleSessionScanner::new(self.shared.active_chats.clone(), offloader)
            .scan()
            .await;
    }
}
