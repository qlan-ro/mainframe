use super::*;
use crate::history_validation::HistoryValidation;
use mainframe_types::sync::LockExt as _;

impl ChatManager {
    pub fn mark_initial_history_served(&self, chat_id: &str, validation: HistoryValidation) {
        self.shared.history_cache.mark_served(chat_id, validation);
    }

    pub fn publish_initial_history_state(&self, chat_id: &str) {
        self.lifecycle.publish_resume_state(chat_id);
    }

    pub fn history_validation(&self, chat_id: &str) -> Option<HistoryValidation> {
        if !self.initial_history_eligible(chat_id) {
            return None;
        }
        let validation = self.shared.history_cache.validation(chat_id)?;
        validation.generation?;
        if !validation.permission_free {
            return None;
        }
        (validation.generation == self.shared.messages.lock_recover().generation(chat_id))
            .then_some(validation)
    }

    pub async fn validate_initial_history(
        &self,
        chat_id: &str,
        validation: &HistoryValidation,
    ) -> bool {
        if !validation.permission_free
            || !self.initial_history_eligible(chat_id)
            || self.shared.messages.lock_recover().get(chat_id).is_some()
        {
            return false;
        }
        self.validate_history(chat_id, validation).await
    }

    pub async fn validate_history(&self, chat_id: &str, validation: &HistoryValidation) -> bool {
        if !validation.permission_free || !self.initial_history_eligible(chat_id) {
            return false;
        }
        if validation.generation.is_some()
            && validation.generation != self.shared.messages.lock_recover().generation(chat_id)
        {
            return false;
        }
        let Some(chat) = self.get_chat(chat_id) else {
            return false;
        };
        let Some(session) =
            crate::chat_manager::build_history_session(&self.shared.deps, &chat, chat_id)
        else {
            return false;
        };
        let context = self.shared.history_context(chat_id);
        HistorySnapshotCache::validate(session.as_ref(), context.as_deref(), validation).await
    }

    fn initial_history_eligible(&self, chat_id: &str) -> bool {
        let Some(chat) = self.get_chat(chat_id) else {
            return false;
        };
        !self.is_chat_running(chat_id)
            && !self.shared.permissions.lock_recover().has_pending(chat_id)
            && chat.process_state != Some(Some(mainframe_types::chat::ProcessState::Working))
            && !chat.temporary
            && !chat.vendor_session_ephemeral
            && self
                .shared
                .deps
                .get_pending_fork(chat_id)
                .is_ok_and(|fork| fork.is_none())
            && self.shared.deps.segment_store().is_none_or(|store| {
                store
                    .layout(chat_id)
                    .is_none_or(|layout| !layout.is_multi_segment())
            })
    }
}
