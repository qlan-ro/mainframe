use super::*;
use crate::transcript::locate_codex_transcript;
use mainframe_types::transcript::TranscriptLocation;
use std::path::PathBuf;

impl CodexSession {
    /// `load_history`'s own rollout file, resolved the same way (`resolve_target`
    /// plus the registry lookup `load_history_inner` never needs because it talks to
    /// the CLI's own app-server instead). Does not report sub-agent child rollouts:
    /// discovering them requires the `thread/read` this method exists to avoid, so
    /// a child-only edit between a chat's own appends can go unnoticed by the
    /// history-cache fingerprint until the parent's own rollout is next appended
    /// to (practically coincident — the parent rollout records the activity ping
    /// that starts/ends a sub-agent turn).
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
                tracing::warn!(module = "codex:session", err = %err, thread_id = %read_thread_id, "codex: failed to load history");
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
            Ok(msgs) => Ok(msgs),
            Err(err) => {
                tracing::warn!(module = "codex:session", err = %err, thread_id = %read_thread_id, "codex: failed to load history");
                Ok(Vec::new())
            }
        }
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
                    module = "codex:session",
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
    let items = read_rollout_items(&rollout_path, Some(thread_id), deps.map(|d| &d.rollout)).await;
    if items.is_empty() {
        return None;
    }
    Some(convert_thread_items(
        &items,
        thread_id,
        &HashMap::new(),
        &HashMap::new(),
    ))
}
