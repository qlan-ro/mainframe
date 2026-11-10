use super::*;
use mainframe_types::chat::Chat;

impl IdleCompactor {
    pub(super) fn eligible(
        &self,
        chat_id: &str,
        now: i64,
    ) -> Option<(
        Arc<dyn AdapterSession>,
        mainframe_db::idle_compaction::RealRun,
    )> {
        self.eligible_for_claim(chat_id, now, None)
    }

    pub(super) fn eligible_for_claim(
        &self,
        chat_id: &str,
        now: i64,
        expected_claim: Option<&str>,
    ) -> Option<(
        Arc<dyn AdapterSession>,
        mainframe_db::idle_compaction::RealRun,
    )> {
        let run = self.shared.deps.idle_run_get(chat_id).ok()??;
        if run.claim.as_deref() != expected_claim {
            return None;
        }
        let cell = self.shared.active(chat_id)?;
        let active = cell.lock_recover().clone();
        let session = active.session?;
        let stored = self.shared.deps.chats_get(chat_id).ok()??;
        if !chat_allowed(&active.chat)
            || !chat_allowed(&stored)
            || active.running_since_ms.is_some()
            || active.turn_started_at.is_some()
            || active.chat.process_state != Some(Some(ProcessState::Idle))
            || active
                .chat
                .last_context_total_tokens
                .is_none_or(|n| n < 20_000)
            || !self.session_due(&session, &active.chat, now, &run)
            || !self.no_pending_work(chat_id)?
        {
            return None;
        }
        let messages = self.shared.messages.lock_recover();
        if !safe_tail(messages.get(chat_id)?) {
            return None;
        }
        Some((session, run))
    }

    fn no_pending_work(&self, chat_id: &str) -> Option<bool> {
        Some(
            self.shared.deps.idle_queue_list(chat_id).ok()?.is_empty()
                && !self.shared.permissions.lock_recover().has_pending(chat_id)
                && self.shared.queued_for_chat(chat_id).is_empty()
                && self.shared.deps.tracker_list_live(chat_id).is_empty(),
        )
    }

    pub(super) fn session_due(
        &self,
        session: &Arc<dyn AdapterSession>,
        chat: &Chat,
        now: i64,
        run: &mainframe_db::idle_compaction::RealRun,
    ) -> bool {
        let ttl = match chat.adapter_id.as_str() {
            "claude" if session.cache_classification() == CacheClassification::Claude1h => {
                CLAUDE_CACHE_TTL_MS
            }
            "codex" => CODEX_CACHE_TTL_MS,
            _ => return false,
        };
        session.adapter_id() == chat.adapter_id
            && session.is_spawned()
            && session.supports_native_compaction()
            && session.ready_for_input()
            && self
                .timing_override
                .unwrap_or_else(|| CompactionTiming::for_ttl(ttl))
                .is_due(now, run.completed_ms)
    }
}

fn chat_allowed(chat: &Chat) -> bool {
    chat.status == ChatStatus::Active
        && chat
            .parent_chat_id
            .as_ref()
            .and_then(|p| p.as_ref())
            .is_none()
        && chat.orchestration.created_by_chat_id.is_none()
        && chat.orchestration.delegation.is_none()
        && chat.orchestration.active_child_ids.is_empty()
        && !chat.orchestration.has_running_delegated_task
        && chat
            .orchestration
            .agent_outbox
            .as_ref()
            .is_none_or(|q| q.is_empty())
}
