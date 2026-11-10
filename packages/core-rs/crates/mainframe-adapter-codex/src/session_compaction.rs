use super::*;
use mainframe_adapter_api::idle_compaction::*;
impl CodexSession {
    pub(super) async fn compact_idle(
        &self,
        request: NativeCompactionRequest,
    ) -> Result<CompactionMetadata, AdapterError> {
        let client = self
            .client
            .lock_recover()
            .clone()
            .ok_or_else(|| AdapterError::NotSpawned(self.id.clone()))?;
        if request.session_generation != self.id {
            return Err(AdapterError::NotSpawned(self.id.clone()));
        }
        let (thread_id, maintenance, receiver) = {
            let mut state = self.state.lock_recover();
            let thread_id = state
                .thread_id
                .clone()
                .ok_or_else(|| AdapterError::NotSpawned(self.id.clone()))?;
            let receiver = state.maintenance.begin(request)?;
            state.compaction_emitted = false;
            state.pending_idle_legacy = false;
            state.maintenance_item_id = None;
            (thread_id, state.maintenance.clone(), receiver)
        };
        if let Err(failure) = client
            .request_with_disposition("thread/compact/start", Some(json!({"threadId":thread_id})))
            .await
        {
            match failure {
                crate::jsonrpc::RpcFailure::Unconfirmed(_) => maintenance.timeout(),
                _ => maintenance.finish(false),
            }
            return Err(AdapterError::Message(
                "native compaction dispatch failed".into(),
            ));
        }
        maintenance
            .wait(receiver, CODEX_COMPACTION_TIMEOUT_MS)
            .await
    }
}

#[cfg(test)]
#[path = "session_compaction_tests.rs"]
mod tests;
