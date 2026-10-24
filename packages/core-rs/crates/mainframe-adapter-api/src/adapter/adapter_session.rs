use super::*;
use std::path::PathBuf;

/// A live adapter session. Trait object stored
/// as `Arc<dyn AdapterSession>`; read-only props are getters, everything async is
/// a hand-rolled `BoxFuture`.
pub trait AdapterSession: Send + Sync {
    fn id(&self) -> &str;
    fn adapter_id(&self) -> &str;
    fn project_path(&self) -> &str;
    fn is_spawned(&self) -> bool;
    /// `supportsReplayAck?` — default `false` (adapter consumes the message
    /// synchronously, so the chat-manager never enrolls it in `queuedRefs`).
    fn supports_replay_ack(&self) -> bool {
        false
    }
    /// `lastActivityAt?` — epoch ms of last protocol activity; `None` means the
    /// idle-eviction scanner treats the session as always-active.
    fn last_activity_at(&self) -> Option<i64> {
        None
    }
    /// Whether [`AdapterSession::steer`] can fold a message into a running
    /// turn. Defaulted to `false`: an adapter without a steer mechanism keeps
    /// today's behavior, and agents queue instead (`not_steerable`).
    fn supports_steer(&self) -> bool {
        false
    }
    /// Delivers `message` into the active turn at its next tool boundary,
    /// never aborting in-flight tool calls.
    fn steer(
        &self,
        message: String,
        uuid: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        let _ = (message, uuid);
        Box::pin(async { Err(AdapterError::Unsupported("steer a running turn")) })
    }

    fn spawn(
        &self,
        options: Option<SessionSpawnOptions>,
        sink: Option<Arc<dyn SessionSink>>,
    ) -> BoxFuture<'_, Result<AdapterProcess, AdapterError>>;
    fn kill(&self) -> BoxFuture<'_, Result<(), AdapterError>>;
    fn get_process_info(&self) -> Option<AdapterProcess>;

    fn send_message(
        &self,
        message: String,
        images: Vec<ImageInput>,
        uuid: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>>;
    fn respond_to_permission(
        &self,
        response: ControlResponse,
    ) -> BoxFuture<'_, Result<(), AdapterError>>;
    fn interrupt(&self) -> BoxFuture<'_, Result<(), AdapterError>>;
    fn model_requires_restart(&self, _model: &str) -> bool {
        false
    }

    fn effective_model(&self) -> BoxFuture<'_, Option<String>> {
        Box::pin(async { None })
    }
    fn set_model(&self, model: String) -> BoxFuture<'_, Result<(), AdapterError>>;
    fn set_permission_mode(&self, mode: ExecutionMode) -> BoxFuture<'_, Result<(), AdapterError>>;
    fn set_plan_mode(&self, on: bool) -> BoxFuture<'_, Result<(), AdapterError>>;
    fn send_command(
        &self,
        command: String,
        args: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>>;
    fn cancel_queued_message(&self, uuid: String) -> BoxFuture<'_, Result<bool, AdapterError>>;
    fn get_context_files(&self) -> ContextFiles;
    fn load_history(&self) -> BoxFuture<'_, Result<Vec<ChatMessage>, AdapterError>>;
    // Codex overrides this because its PR scan reconstructs tool output from rollout files.
    fn load_scan_records<'a>(
        &'a self,
        canonical: Option<&'a [ChatMessage]>,
    ) -> BoxFuture<'a, Result<std::borrow::Cow<'a, [ChatMessage]>, AdapterError>> {
        Box::pin(async move {
            match canonical {
                Some(history) => Ok(std::borrow::Cow::Borrowed(history)),
                None => self.load_history().await.map(std::borrow::Cow::Owned),
            }
        })
    }
    fn extract_plan_files(&self) -> BoxFuture<'_, Result<Vec<String>, AdapterError>>;
    fn extract_skill_files(&self) -> BoxFuture<'_, Result<Vec<SkillFileEntry>, AdapterError>>;

    /// The transcript file(s) whose `(path, byte length, mtime)` define this
    /// session's history-cache freshness (`mainframe_chat`'s persistent
    /// snapshot cache, built around `load_history`'s cost on a large
    /// transcript). Resolved exactly as `load_history` resolves its own
    /// sources, so a fingerprint built from this list misses the moment
    /// `load_history`'s result would actually change.
    ///
    /// Default returns an empty list, meaning "do not cache": an adapter that
    /// cannot cheaply enumerate its own transcript files (or whose history
    /// comes from somewhere other than a stat-able local file, e.g. a remote
    /// protocol round trip) opts out rather than risk a false cache hit.
    fn history_sources(&self) -> BoxFuture<'_, Vec<PathBuf>> {
        Box::pin(async { Vec::new() })
    }

    /// Dependencies observed during the last load; `None` disables snapshot writes.
    fn history_dependencies(&self) -> Option<Vec<crate::HistoryDependency>> {
        Some(Vec::new())
    }

    fn history_state(&self) -> serde_json::Value {
        serde_json::Value::Null
    }

    fn validate_history_state<'a>(&'a self, state: &'a serde_json::Value) -> BoxFuture<'a, bool> {
        Box::pin(async move { state.is_null() })
    }

    /// Stop a running background task by id. Adapters without bg-task support
    /// resolve `{ ok: false, error: "unsupported" }`.
    fn stop_background_task(
        &self,
        task_id: String,
    ) -> BoxFuture<'_, Result<StopBackgroundTaskResult, AdapterError>>;

    /// Apply a fully-resolved tuning to a live session. Optional; the default is
    /// a no-op.
    fn apply_tuning(&self, tuning: ResolvedTuning) -> BoxFuture<'_, Result<(), AdapterError>> {
        let _ = tuning;
        Box::pin(async { Ok(()) })
    }
}
