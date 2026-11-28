//! [`ChatRelease`]: the per-chat re-check and release the scanner drives.

use mainframe_adapter_api::idle_compaction::{CLAUDE_CACHE_TTL_MS, CODEX_CACHE_TTL_MS};
use mainframe_types::chat::ProcessState;
use mainframe_types::settings::HistoryReleaseConfig;
use mainframe_types::time::now_ms;
use tracing::debug;

use super::*;
use crate::chat_manager::ChatShared;
use crate::chat_teardown::{ChatTeardown, TeardownMode};
use crate::lifecycle_manager::ChatLifecycleManager;

/// Releases one chat's history at a time, built from the manager's shared
/// state like `ChatOffload`.
pub struct ChatRelease {
    shared: Arc<ChatShared>,
    lifecycle: Arc<ChatLifecycleManager>,
    teardown: Arc<ChatTeardown>,
}

impl ChatRelease {
    pub(crate) fn new(
        shared: Arc<ChatShared>,
        lifecycle: Arc<ChatLifecycleManager>,
        teardown: Arc<ChatTeardown>,
    ) -> Self {
        Self {
            shared,
            lifecycle,
            teardown,
        }
    }

    async fn try_release(&self, chat_id: &str, idle_before: i64) {
        if !self.holds_history(chat_id) || self.idle_compaction_open(chat_id).await {
            return;
        }
        // A delegated task on either side of the chat keeps it; holding the
        // reservation stops a new delegation from starting mid-release.
        let Some(delegation) = self
            .lifecycle
            .orchestration()
            .reserve_idle_close(chat_id)
            .await
        else {
            return;
        };
        // Loads, starts, sends, interrupts and history reads exclude the
        // release, and wait for it to finish before they read the cache.
        let Some(claim) = self.lifecycle.try_claim_offload(chat_id) else {
            return;
        };
        if let Some(reason) = self.blocker(chat_id, idle_before) {
            debug!(chat_id, reason, "kept chat history");
            return;
        }
        self.teardown.clear(chat_id, TeardownMode::ReleaseHistory);
        drop(claim);
        drop(delegation);
        self.lifecycle.notify_history_released(chat_id);
        info!(chat_id, "released chat history");
    }

    /// Why the chat must keep its history, or `None` when it may go. Runs under
    /// the offload claim, so a chat that woke up since its selection stays.
    fn blocker(&self, chat_id: &str, idle_before: i64) -> Option<&'static str> {
        let cell = self.shared.active(chat_id)?;
        let active = cell.lock_recover().clone();
        let chat = &active.chat;
        if chat.process_state == Some(Some(ProcessState::Working))
            || active.running_since_ms.is_some()
            || active.turn_started_at.is_some()
        {
            return Some("working");
        }
        if active
            .session
            .as_ref()
            .is_some_and(|s| s.is_spawned() && s.blocks_idle_offload())
        {
            return Some("session busy");
        }
        let orchestration = &chat.orchestration;
        if orchestration.has_running_delegated_task || !orchestration.active_child_ids.is_empty() {
            return Some("delegated work");
        }
        if !self.shared.orchestration.agent_outbox(chat_id).is_empty() {
            return Some("agent outbox");
        }
        if release_idle_since(active.session.as_ref(), active.last_used_at)
            .is_none_or(|last| last >= idle_before)
        {
            return Some("recently used");
        }
        if self.shared.permissions.lock_recover().has_pending(chat_id) {
            return Some("pending permission");
        }
        let maintenance_queue_empty = self
            .shared
            .deps
            .idle_queue_list(chat_id)
            .is_ok_and(|queue| queue.is_empty());
        if !self.shared.queued_for_chat(chat_id).is_empty() || !maintenance_queue_empty {
            return Some("queued message");
        }
        if !self.shared.deps.tracker_list_live(chat_id).is_empty() {
            return Some("background task");
        }
        if !self.reloadable(chat) {
            return Some("not reloadable");
        }
        if self.shared.is_viewed(chat_id) {
            return Some("viewed");
        }
        None
    }

    /// Whether the transcript can give the history back: the chat has one on
    /// disk (its own session, or segments to compose), it is not temporary or
    /// ephemeral, and it is not a fork still waiting for its first send.
    fn reloadable(&self, chat: &mainframe_types::chat::Chat) -> bool {
        let multi_segment = self
            .shared
            .deps
            .segment_store()
            .and_then(|store| store.layout(&chat.id))
            .is_some_and(|layout| layout.is_multi_segment());
        !chat.temporary
            && !chat.vendor_session_ephemeral
            && chat.transcript_missing != Some(true)
            && (chat.vendor_session_id.is_some() || multi_segment)
            && self
                .shared
                .deps
                .get_pending_fork(&chat.id)
                .is_ok_and(|fork| fork.is_none())
    }

    /// An idle compaction still due reads the chat's history, so the chat keeps
    /// it until its run is claimed or the provider's cache window has passed.
    /// A storage error keeps it too.
    async fn idle_compaction_open(&self, chat_id: &str) -> bool {
        let enabled = mainframe_services::settings::read_setting(
            self.shared.deps.settings(),
            "general",
            "idleCompaction.enabled",
        )
        .await;
        if enabled.as_deref() != Some("true") {
            return false;
        }
        let run = match self.shared.deps.idle_run_get(chat_id) {
            Ok(run) => run,
            Err(_) => return true,
        };
        let Some(mainframe_db::idle_compaction::RealRun {
            completed_ms: Some(completed),
            claim: None,
            ..
        }) = run
        else {
            return false;
        };
        let codex = self
            .shared
            .active(chat_id)
            .is_some_and(|cell| cell.lock_recover().chat.adapter_id == "codex");
        let window = if codex {
            CODEX_CACHE_TTL_MS
        } else {
            CLAUDE_CACHE_TTL_MS
        };
        now_ms() - completed < window as i64
    }
}

impl HistoryReleaser for ChatRelease {
    fn release_after_ms(&self) -> BoxFuture<'_, Option<i64>> {
        Box::pin(async move {
            let raw = mainframe_services::settings::read_setting(
                self.shared.deps.settings(),
                "general",
                "historyRelease.idleMinutes",
            )
            .await;
            HistoryReleaseConfig::from_stored(raw.as_deref()).idle_ms()
        })
    }

    fn holds_history(&self, chat_id: &str) -> bool {
        self.shared.messages.lock_recover().get(chat_id).is_some()
    }

    fn is_viewed(&self, chat_id: &str) -> bool {
        self.shared.is_viewed(chat_id)
    }

    fn release<'a>(&'a self, chat_id: &'a str, idle_before: i64) -> BoxFuture<'a, ()> {
        Box::pin(self.try_release(chat_id, idle_before))
    }
}
