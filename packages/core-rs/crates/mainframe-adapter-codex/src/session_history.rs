use super::*;
use crate::transcript::locate_codex_transcript;
use mainframe_types::transcript::TranscriptLocation;
use std::path::PathBuf;

impl CodexSession {
    pub(super) async fn history_sources_inner(&self) -> Vec<PathBuf> {
        let thread_id = match self.resolve_target(false).await {
            ThreadTarget::Resume(id) => id,
            ThreadTarget::Fork { source_id, .. } => source_id,
            ThreadTarget::Start => return Vec::new(),
        };
        match locate_codex_transcript(&thread_id, None).await {
            Some(TranscriptLocation::Present(path)) => vec![PathBuf::from(path)],
            _ => Vec::new(),
        }
    }
    pub(super) async fn load_history_inner(&self) -> Result<Vec<ChatMessage>, AdapterError> {
        *self.history_dependencies.lock_recover() = None;
        *self.history_state.lock_recover() = serde_json::Value::Null;
        let (read_thread_id, turn_cap) = match self.resolve_target(false).await {
            ThreadTarget::Resume(id) => (id, None),
            ThreadTarget::Fork {
                source_id,
                last_turn_id,
            } => (source_id, last_turn_id),
            ThreadTarget::Start => return Ok(Vec::new()),
        };

        let executable = self.history_executable.lock_recover().clone();
        let temp = match spawn_temp_app_server(
            &executable,
            Some(Path::new(&self.project_path)),
            true,
            self.resolved_path.as_str(),
        )
        .await
        {
            Ok(c) => c,
            Err(err) => {
                tracing::warn!(error = %err, thread_id = %read_thread_id, "failed to load history");
                return Ok(Vec::new());
            }
        };

        let result = load_history_inner(
            &temp,
            &read_thread_id,
            &self.project_path,
            turn_cap.as_deref(),
        )
        .await;
        temp.close();
        match result {
            Ok(loaded) => {
                *self.history_dependencies.lock_recover() = loaded.dependencies;
                *self.history_state.lock_recover() = loaded.state;
                Ok(loaded.messages)
            }
            Err(err) => {
                tracing::warn!(error = %err, thread_id = %read_thread_id, "failed to load history");
                Ok(Vec::new())
            }
        }
    }
    /// A page of the thread's turns through `thread/turns/list`, or `None`
    /// when this session cannot be paged (a fork that has not sent, a thread
    /// that is not yet started, or a CLI without the method).
    pub(super) async fn load_history_page_inner(
        &self,
        cursor: Option<String>,
        turns: usize,
    ) -> Result<Option<mainframe_adapter_api::HistoryPage>, AdapterError> {
        let ThreadTarget::Resume(thread_id) = self.resolve_target(false).await else {
            return Ok(None);
        };
        let executable = self.history_executable.lock_recover().clone();
        let temp = match spawn_temp_app_server(
            &executable,
            Some(Path::new(&self.project_path)),
            true,
            self.resolved_path.as_str(),
        )
        .await
        {
            Ok(client) => client,
            Err(err) => {
                tracing::warn!(error = %err, thread_id = %thread_id, "failed to page history");
                return Ok(None);
            }
        };
        let page =
            crate::history_page::load_page(&temp, &thread_id, cursor.as_deref(), turns).await;
        temp.close();
        page
    }
    pub(super) async fn load_scan_records_inner(&self) -> Result<Vec<ChatMessage>, AdapterError> {
        let Some(thread_id) = self.resume_thread_id.clone() else {
            return Ok(Vec::new());
        };
        let deps = self.scan_deps.lock_recover().clone();
        match rollout_scan_records(&thread_id, deps.as_ref()).await {
            Some(records) => Ok(records),
            None => {
                tracing::debug!(
                    thread_id,
                    "no rollout for PR scan; falling back to thread/read"
                );
                self.load_history().await
            }
        }
    }
}

pub(super) async fn rollout_scan_records(
    thread_id: &str,
    deps: Option<&CodexScanDeps>,
) -> Option<Vec<ChatMessage>> {
    let thread_ids = [thread_id.to_string()];
    let meta = lookup_agent_metadata_with(&thread_ids, deps.map(|d| &d.registry));
    let rollout_path = meta.get(thread_id)?.rollout_path.clone()?;
    crate::rollout_turns::read_rollout_history(&rollout_path, thread_id, deps.map(|d| &d.rollout))
        .await
}

/// What `stop_background_task` answers: Codex has no background tasks to stop.
pub(super) async fn unsupported_stop() -> Result<StopBackgroundTaskResult, AdapterError> {
    Ok(StopBackgroundTaskResult {
        ok: false,
        error: Some("unsupported".to_string()),
    })
}
