//! The cached history read behind `get_messages`: one restore path for a
//! released chat, and installs that never overwrite a history written while
//! they read.
use super::*;
use mainframe_types::sync::LockExt as _;

impl ChatManager {
    /// Cached messages, falling back to a one-shot on-disk history load (Claude
    /// `--resume` JSONL). The load remaps the embedded Claude sessionId back to the
    /// Mainframe chatId and restores any pending permission from history.
    pub async fn get_messages(&self, chat_id: &str) -> Vec<ChatMessage> {
        // A pass ends in a read, a restore or a reason to stop; a chat released
        // again between passes gets another, and a bounded number of them.
        for _ in 0..3 {
            self.lifecycle.await_restoring(chat_id).await;
            // Wait out an in-flight offload before reading the cache/registry:
            // an offload that just cleared the cache must not race a reader that
            // would otherwise see a half-cleared cache.
            self.lifecycle.await_offload(chat_id).await;
            // A released chat comes back only through the lifecycle's restore
            // claim, the one a send takes too. A failed restore installs
            // nothing, and nothing else reads it in its place.
            if self.lifecycle.history_released(chat_id)
                && let Err(err) = self.lifecycle.restore_released_history(chat_id).await
            {
                tracing::warn!(chat_id, error = %err, "released history restore failed");
                return Vec::new();
            }

            if let Some(cached) = self.cached_messages(chat_id) {
                // Reading a chat's history is a use of it.
                self.lifecycle.touch(chat_id);
                return cached;
            }

            // Single-flight the on-disk read (Established facts: two concurrent
            // misses used to both hit disk). The follower re-reads the cache the
            // leader just populated instead of loading a second time. A chat
            // released since the check above goes back to the shared restore.
            use crate::lifecycle_manager::release::HistoryRead;
            match self.lifecycle.claim_history_read(chat_id).await {
                HistoryRead::Released => continue,
                HistoryRead::Follower => return self.cached_messages(chat_id).unwrap_or_default(),
                HistoryRead::Lead(claim) => return self.read_history_with(chat_id, claim).await,
            }
        }
        tracing::warn!(
            chat_id,
            "history read gave up on a chat released again and again"
        );
        Vec::new()
    }

    async fn read_history_with(
        &self,
        chat_id: &str,
        claim: mainframe_runtime::sync::FlightClaim,
    ) -> Vec<ChatMessage> {
        let started = std::time::Instant::now();
        let result = self.load_history_into_cache(chat_id).await;
        tracing::info!(
            chat_id,
            history_load_ms = started.elapsed().as_secs_f64() * 1000.0,
            "chat history loaded"
        );
        self.lifecycle.touch(chat_id);
        drop(claim);
        result
    }

    fn cached_messages(&self, chat_id: &str) -> Option<Vec<ChatMessage>> {
        let cached = self.shared.messages.lock_recover().get(chat_id).cloned();
        cached.filter(|c| !c.is_empty())
    }

    /// The lead caller's actual disk read behind `claim_history`'s single
    /// flight: consult the history snapshot cache first (a hit skips the
    /// parse entirely), else load + remap as before and write a snapshot for
    /// next time; either way, cache in memory + restore any pending
    /// permission found in the transcript (when non-empty). The install is
    /// skipped when anything wrote the history since the read began: that
    /// newer history is returned instead.
    async fn load_history_into_cache(&self, chat_id: &str) -> Vec<ChatMessage> {
        let read_from = self.shared.messages.lock_recover().history_epoch(chat_id);
        // Multi-segment chats compose from several transcripts; the snapshot
        // cache keys on one session's sources, so they bypass it.
        if let Some(composed) = compose_if_multi(self.shared.deps.as_ref(), chat_id).await {
            return self.finish_composed_load(chat_id, read_from, composed);
        }
        let Some(session) = self.history_session(chat_id) else {
            return Vec::new();
        };
        match self
            .shared
            .load_cached_history(chat_id, session.as_ref())
            .await
        {
            Ok(history) => self.finish_history_load(chat_id, read_from, history),
            Err(_) => Vec::new(),
        }
    }

    /// Shared tail of a cache hit and a cache miss: settle `remapped` into
    /// the in-memory cache and restore any pending permission it carries.
    /// Skipped for an empty history — same early-out the pre-cache code had,
    /// so an adapter session with nothing to load never pins an empty entry.
    fn finish_history_load(
        &self,
        chat_id: &str,
        read_from: u64,
        remapped: Vec<ChatMessage>,
    ) -> Vec<ChatMessage> {
        if remapped.is_empty() {
            return remapped;
        }
        let installed = self
            .shared
            .messages
            .lock_recover()
            .install_history(chat_id, read_from, remapped);
        let Some(remapped) = installed else {
            return self.cached_messages(chat_id).unwrap_or_default();
        };
        self.shared
            .permissions
            .lock_recover()
            .restore_pending_permission(chat_id, &remapped);
        self.shared.mark_history_restored(chat_id);
        remapped
    }

    /// A pending permission is restored only from the active segment's slice:
    /// a dangling request in an earlier segment's transcript is never revived.
    fn finish_composed_load(
        &self,
        chat_id: &str,
        read_from: u64,
        composed: crate::segments::compose::Composed,
    ) -> Vec<ChatMessage> {
        if composed.messages.is_empty() {
            return composed.messages;
        }
        let installed = self.shared.messages.lock_recover().install_history(
            chat_id,
            read_from,
            composed.messages,
        );
        let Some(stored) = installed else {
            return self.cached_messages(chat_id).unwrap_or_default();
        };
        self.shared
            .messages
            .lock_recover()
            .mark_partial(chat_id, composed.incomplete);
        let active_slice = &stored[composed.active_from.min(stored.len())..];
        self.shared
            .permissions
            .lock_recover()
            .restore_pending_permission(chat_id, active_slice);
        stored
    }
}
