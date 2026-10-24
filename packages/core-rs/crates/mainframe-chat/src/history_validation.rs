use mainframe_adapter_api::{AdapterSession, HistoryDependency};
use mainframe_types::sync::LockExt as _;
use serde::{Deserialize, Serialize};

use crate::history_cache::{HistoryFingerprint, HistorySnapshotCache};

#[derive(Clone, Serialize, Deserialize)]
pub struct HistoryValidation {
    #[serde(skip)]
    pub(crate) generation: Option<u64>,
    #[serde(default)]
    pub(crate) permission_free: bool,
    pub(crate) fingerprint: HistoryFingerprint,
    pub(crate) dependencies: Vec<HistoryDependency>,
    pub(crate) adapter_state: serde_json::Value,
}

impl HistoryValidation {
    pub(crate) fn new(
        fingerprint: HistoryFingerprint,
        dependencies: Vec<HistoryDependency>,
        adapter_state: serde_json::Value,
    ) -> Self {
        Self {
            fingerprint,
            dependencies,
            adapter_state,
            generation: None,
            permission_free: false,
        }
    }
}

impl HistorySnapshotCache {
    pub(crate) fn remember(&self, chat_id: &str, validation: HistoryValidation) {
        let mut entries = self.validated.lock_recover();
        if entries.len() >= self.max_snapshots
            && !entries.contains_key(chat_id)
            && let Some(oldest) = entries.keys().next().cloned()
        {
            entries.remove(&oldest);
        }
        entries.insert(chat_id.to_owned(), validation);
    }

    pub(crate) fn validation(&self, chat_id: &str) -> Option<HistoryValidation> {
        self.validated.lock_recover().get(chat_id).cloned()
    }

    pub(crate) async fn validate(
        session: &dyn AdapterSession,
        context: Option<&str>,
        validation: &HistoryValidation,
    ) -> bool {
        if Self::fingerprint(session, context).await.as_ref() != Some(&validation.fingerprint) {
            return false;
        }
        for source in &validation.dependencies {
            if !source.is_current().await {
                return false;
            }
        }
        session
            .validate_history_state(&validation.adapter_state)
            .await
            && Self::fingerprint(session, context).await.as_ref() == Some(&validation.fingerprint)
    }
}

impl crate::chat_manager::ChatShared {
    pub(crate) fn mark_history_restored(&self, chat_id: &str) {
        let generation = self.messages.lock_recover().generation(chat_id);
        let permission_free = !self.permissions.lock_recover().has_pending(chat_id);
        if let Some(validation) = self.history_cache.validated.lock_recover().get_mut(chat_id) {
            validation.generation = generation;
            validation.permission_free = permission_free;
        }
    }
}

impl crate::message_cache::MessageCache {
    pub(crate) fn generation(&self, chat_id: &str) -> Option<u64> {
        self.get(chat_id)?;
        self.generations.get(chat_id).copied()
    }
    pub(super) fn mark_mutated(&mut self, chat_id: &str) {
        self.next_generation = self.next_generation.wrapping_add(1);
        if self.get(chat_id).is_some() {
            self.generations
                .insert(chat_id.to_owned(), self.next_generation);
        } else {
            self.generations.remove(chat_id);
        }
    }
}

impl HistorySnapshotCache {
    pub(crate) fn mark_served(&self, chat_id: &str, validation: HistoryValidation) {
        let mut served = self.served.lock_recover();
        if served.len() >= self.max_snapshots
            && !served.contains_key(chat_id)
            && let Some(id) = served.keys().next().cloned()
        {
            served.remove(&id);
        }
        served.insert(chat_id.to_owned(), validation);
    }

    pub(crate) fn consume_served(&self, chat_id: &str) -> bool {
        let served = self.served.lock_recover().remove(chat_id);
        let current = self.validation(chat_id);
        served.zip(current).is_some_and(|(served, current)| {
            current.permission_free
                && served.fingerprint == current.fingerprint
                && served.dependencies == current.dependencies
                && served.adapter_state == current.adapter_state
        })
    }

    pub(crate) fn forget_served(&self, chat_id: &str) {
        self.served.lock_recover().remove(chat_id);
    }
}
