//! A minimal `Adapter`/`AdapterSession` pair that actually "spawns" (unlike
//! `routes/session_transcripts.rs`'s `StubAdapter`, whose `create_session` is
//! `unreachable!`) — for route tests that need `ctx.chat_manager` wired to a
//! real `ChatManager` (todo #346, AC 26) and drive it through a create/start
//! round trip without touching a real CLI process.
#![cfg(test)]

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use mainframe_adapter_api::{
    Adapter, AdapterError, AdapterSession, BoxFuture, ContextFiles, ImageInput,
    StopBackgroundTaskResult,
};
use mainframe_types::adapter::{
    AdapterCapabilities, AdapterModel, AdapterProcess, AdapterProcessStatus, ControlResponse,
    SessionOptions, SessionSpawnOptions,
};
use mainframe_types::chat::{ChatMessage, ResolvedTuning};
use mainframe_types::context::SkillFileEntry;
use mainframe_types::settings::ExecutionMode;

mod app_ctx;

pub(crate) use app_ctx::{test_ctx, test_ctx_with_chat_manager};

static NEXT_SESSION_ID: AtomicUsize = AtomicUsize::new(1);

/// Registers under whatever `id` it is built with (route tests use `"claude"`
/// to match their bodies' `adapterId`). `no_persistence` mirrors the
/// registry capability the rule-7 spawn decision reads.
pub(crate) struct StubAdapter {
    id: String,
    no_persistence: bool,
    /// How many `StubSession::kill` calls this adapter's sessions have seen
    /// (shared across every session it hands out) — lets a caller prove a
    /// project/chat teardown actually stopped a live process.
    pub(crate) kills: Arc<AtomicUsize>,
}

impl StubAdapter {
    pub(crate) fn new(id: &str, no_persistence: bool) -> Arc<Self> {
        Arc::new(Self {
            id: id.to_string(),
            no_persistence,
            kills: Arc::new(AtomicUsize::new(0)),
        })
    }
}

impl Adapter for StubAdapter {
    fn id(&self) -> &str {
        &self.id
    }
    fn name(&self) -> &str {
        &self.id
    }
    fn capabilities(&self) -> AdapterCapabilities {
        AdapterCapabilities {
            plan_mode: false,
            auto_mode: false,
            no_persistence: self.no_persistence,
        }
    }
    fn is_installed(&self) -> BoxFuture<'_, Result<bool, AdapterError>> {
        Box::pin(async { Ok(true) })
    }
    fn get_version(&self) -> BoxFuture<'_, Result<Option<String>, AdapterError>> {
        Box::pin(async { Ok(None) })
    }
    fn list_models(&self) -> BoxFuture<'_, Result<Vec<AdapterModel>, AdapterError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn create_session(&self, options: SessionOptions) -> Arc<dyn AdapterSession> {
        let id = options.chat_id.clone().unwrap_or_else(|| {
            let n = NEXT_SESSION_ID.fetch_add(1, Ordering::SeqCst);
            format!("stub-sess-{n}")
        });
        Arc::new(StubSession {
            id,
            adapter_id: self.id.clone(),
            project_path: options.project_path,
            kills: self.kills.clone(),
        })
    }
    fn kill_all(&self) {}
}

struct StubSession {
    id: String,
    adapter_id: String,
    project_path: String,
    kills: Arc<AtomicUsize>,
}

fn ok<'a>() -> BoxFuture<'a, Result<(), AdapterError>> {
    Box::pin(async { Ok(()) })
}

impl AdapterSession for StubSession {
    fn id(&self) -> &str {
        &self.id
    }
    fn adapter_id(&self) -> &str {
        &self.adapter_id
    }
    fn project_path(&self) -> &str {
        &self.project_path
    }
    fn is_spawned(&self) -> bool {
        false
    }
    fn spawn(
        &self,
        _options: Option<SessionSpawnOptions>,
        sink: Option<Arc<dyn mainframe_adapter_api::SessionSink>>,
    ) -> BoxFuture<'_, Result<AdapterProcess, AdapterError>> {
        Box::pin(async move {
            if let Some(sink) = sink {
                sink.on_init(&self.id);
            }
            Ok(AdapterProcess {
                id: self.id.clone(),
                adapter_id: self.adapter_id.clone(),
                chat_id: self.id.clone(),
                pid: 0,
                status: AdapterProcessStatus::Running,
                project_path: self.project_path.clone(),
                model: None,
            })
        })
    }
    fn kill(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.kills.fetch_add(1, Ordering::SeqCst);
        ok()
    }
    fn get_process_info(&self) -> Option<AdapterProcess> {
        None
    }
    fn send_message(
        &self,
        _message: String,
        _images: Vec<ImageInput>,
        _uuid: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        ok()
    }
    fn respond_to_permission(
        &self,
        _response: ControlResponse,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        ok()
    }
    fn interrupt(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        ok()
    }
    fn set_model(&self, _model: String) -> BoxFuture<'_, Result<(), AdapterError>> {
        ok()
    }
    fn set_permission_mode(&self, _mode: ExecutionMode) -> BoxFuture<'_, Result<(), AdapterError>> {
        ok()
    }
    fn set_plan_mode(&self, _on: bool) -> BoxFuture<'_, Result<(), AdapterError>> {
        ok()
    }
    fn send_command(
        &self,
        _command: String,
        _args: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        ok()
    }
    fn cancel_queued_message(&self, _uuid: String) -> BoxFuture<'_, Result<bool, AdapterError>> {
        Box::pin(async { Ok(false) })
    }
    fn get_context_files(&self) -> ContextFiles {
        ContextFiles::default()
    }
    fn load_history(&self) -> BoxFuture<'_, Result<Vec<ChatMessage>, AdapterError>> {
        Box::pin(async { Ok(Vec::new()) })
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
        ok()
    }
}

// Not a port; test scaffolding only. No PORT STATUS trailer.
