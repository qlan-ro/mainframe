use std::sync::Arc;
use std::sync::atomic::Ordering;

use mainframe_adapter_api::{
    AdapterError, AdapterSession, BoxFuture, ContextFiles, ImageInput, SessionSink,
    StopBackgroundTaskResult,
};
use mainframe_types::adapter::{AdapterProcess, ControlResponse, SessionSpawnOptions};
use mainframe_types::chat::{ChatMessage, ResolvedTuning};
use mainframe_types::context::SkillFileEntry;
use mainframe_types::settings::ExecutionMode;

use crate::fixture::messages_from_events;
use crate::history::remap_history_paths;
use crate::session::ReplaySession;

impl AdapterSession for ReplaySession {
    fn id(&self) -> &str {
        &self.id
    }

    fn adapter_id(&self) -> &str {
        "mock-cli"
    }

    fn project_path(&self) -> &str {
        &self.project_path
    }

    fn is_spawned(&self) -> bool {
        self.spawned.load(Ordering::SeqCst)
    }

    fn spawn(
        &self,
        _options: Option<SessionSpawnOptions>,
        sink: Option<Arc<dyn SessionSink>>,
    ) -> BoxFuture<'_, Result<AdapterProcess, AdapterError>> {
        Box::pin(async move {
            self.ensure_loaded().await?;
            self.spawned.store(true, Ordering::SeqCst);
            *self.sink.lock().unwrap_or_else(|e| e.into_inner()) = sink;
            let (batch, base) = {
                let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
                let base = state.last_delay;
                let batch = state.replay.drain_outputs();
                if let Some(last) = batch.last() {
                    state.last_delay = last.delay_ms;
                }
                (batch, base)
            };
            self.emit(batch, base).await;
            Ok(self.process_info())
        })
    }

    fn kill(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async move {
            self.spawned.store(false, Ordering::SeqCst);
            Ok(())
        })
    }

    fn get_process_info(&self) -> Option<AdapterProcess> {
        self.is_spawned().then(|| self.process_info())
    }

    fn send_message(
        &self,
        _message: String,
        _images: Vec<ImageInput>,
        _uuid: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async move {
            self.advance("sendMessage").await;
            Ok(())
        })
    }

    fn respond_to_permission(
        &self,
        _response: ControlResponse,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async move {
            self.advance("respondToPermission").await;
            Ok(())
        })
    }

    fn interrupt(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async move {
            self.advance("interrupt").await;
            Ok(())
        })
    }

    fn set_model(&self, _model: String) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }

    fn set_permission_mode(&self, _mode: ExecutionMode) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }

    fn set_plan_mode(&self, _on: bool) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }

    fn send_command(
        &self,
        _command: String,
        _args: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }

    fn cancel_queued_message(&self, _uuid: String) -> BoxFuture<'_, Result<bool, AdapterError>> {
        Box::pin(async { Ok(false) })
    }

    fn get_context_files(&self) -> ContextFiles {
        ContextFiles::default()
    }

    fn load_history(&self) -> BoxFuture<'_, Result<Vec<ChatMessage>, AdapterError>> {
        Box::pin(async move {
            self.ensure_loaded().await?;
            let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            let mut history = messages_from_events(&state.replay.events, &self.id);
            remap_history_paths(&mut history, &self.project_path);
            Ok(history)
        })
    }

    fn extract_plan_files(&self) -> BoxFuture<'_, Result<Vec<String>, AdapterError>> {
        Box::pin(async { Ok(Vec::new()) })
    }

    fn extract_skill_files(&self) -> BoxFuture<'_, Result<Vec<SkillFileEntry>, AdapterError>> {
        Box::pin(async { Ok(Vec::new()) })
    }

    fn stop_background_task(
        &self,
        _task_id: String,
    ) -> BoxFuture<'_, Result<StopBackgroundTaskResult, AdapterError>> {
        Box::pin(async {
            Ok(StopBackgroundTaskResult {
                ok: false,
                error: Some("unsupported".to_string()),
            })
        })
    }

    fn apply_tuning(&self, _tuning: ResolvedTuning) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }
}
