use super::*;
use mainframe_adapter_api::idle_compaction::{CompactionTiming, IDLE_COMPACTION_SWEEP_MS};
use mainframe_types::sync::LockExt as _;

pub fn validate_idle_compaction_config()
-> Result<Option<CompactionTiming>, mainframe_types::seam_error::SeamError> {
    match std::env::var("MAINFRAME_IDLE_COMPACTION_DELAY_MS") {
        Ok(value) => CompactionTiming::from_override(&value)
            .map(Some)
            .map_err(mainframe_types::seam_error::SeamError::msg),
        Err(std::env::VarError::NotPresent) => Ok(None),
        Err(_) => Err(mainframe_types::seam_error::SeamError::msg(
            "MAINFRAME_IDLE_COMPACTION_DELAY_MS must be Unicode",
        )),
    }
}

impl ChatManager {
    pub(super) fn start_compaction_scanner(self: &Arc<Self>) {
        let mut slot = self.compaction_scanner.lock_recover();
        if slot.is_some() {
            return;
        }
        let weak = Arc::downgrade(self);
        let timing = match validate_idle_compaction_config() {
            Ok(value) => value,
            Err(_) => {
                tracing::error!("invalid idle compaction configuration");
                return;
            }
        };
        let interval = timing.map_or(IDLE_COMPACTION_SWEEP_MS, |t| t.sweep_ms);
        *slot = Some(tokio::spawn(async move {
            let mut ticker = tokio::time::interval(std::time::Duration::from_millis(interval));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            ticker.tick().await;
            loop {
                ticker.tick().await;
                let Some(manager) = weak.upgrade() else {
                    break;
                };
                manager.scan_idle_compactions().await;
            }
        }));
    }

    pub async fn scan_idle_compactions(&self) {
        let Ok(timing_override) = validate_idle_compaction_config() else {
            return;
        };
        let compactor = crate::idle_compaction::IdleCompactor {
            shared: self.shared.clone(),
            lifecycle: self.lifecycle.clone(),
            timing_override,
            now: Arc::new(mainframe_types::time::now_ms),
        };
        let ids: Vec<_> = self
            .shared
            .active_chats
            .iter()
            .map(|e| e.key().clone())
            .collect();
        let mut evaluations = tokio::task::JoinSet::new();
        for id in ids {
            let compactor = compactor.clone();
            evaluations.spawn(async move {
                compactor.evaluate(&id).await;
            });
        }
        while let Some(result) = evaluations.join_next().await {
            if result.is_err() {
                tracing::warn!("idle compaction evaluation stopped");
            }
        }
    }
}

impl ChatShared {
    pub(crate) fn schedule_idle_evaluation(&self, chat_id: &str) {
        let Some(manager) = self.manager.get().and_then(|m| m.upgrade()) else {
            return;
        };
        let chat_id = chat_id.to_owned();
        tokio::spawn(async move {
            let Ok(timing_override) = validate_idle_compaction_config() else {
                return;
            };
            crate::idle_compaction::IdleCompactor {
                shared: manager.shared.clone(),
                lifecycle: manager.lifecycle.clone(),
                timing_override,
                now: Arc::new(mainframe_types::time::now_ms),
            }
            .evaluate(&chat_id)
            .await;
        });
    }
}
