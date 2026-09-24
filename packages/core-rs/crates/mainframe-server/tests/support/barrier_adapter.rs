//! A minimal `Adapter` whose session `spawn()` blocks on a `oneshot` gate
//! until released (todo #350, plan task 10) — the deterministic
//! (non-timing-dependent) way to prove a slow cold-chat start does not block
//! the socket loop's handling of a concurrent frame for another chat.
//! Every other method is a trivial success stub: the test that uses this
//! adapter only cares about the spawn barrier.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

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

/// One `interrupt()` call, recorded with whether the blocked `spawn()` had
/// already returned when it arrived — the ordering a cancel racing its own
/// prompt turns on.
pub type InterruptLog = Arc<Mutex<Vec<bool>>>;

pub struct BarrierAdapter {
    gate: Arc<Mutex<Option<tokio::sync::oneshot::Receiver<()>>>>,
    spawned: Arc<AtomicBool>,
    interrupts: InterruptLog,
}

impl BarrierAdapter {
    /// Returns the adapter plus the sender that releases its one spawn call.
    pub fn new() -> (Self, tokio::sync::oneshot::Sender<()>) {
        let (tx, rx) = tokio::sync::oneshot::channel();
        (
            Self {
                gate: Arc::new(Mutex::new(Some(rx))),
                spawned: Arc::new(AtomicBool::new(false)),
                interrupts: Arc::new(Mutex::new(Vec::new())),
            },
            tx,
        )
    }

    /// Share the interrupt log before the adapter is handed to the registry.
    pub fn interrupt_log(&self) -> InterruptLog {
        Arc::clone(&self.interrupts)
    }
}

impl Adapter for BarrierAdapter {
    fn id(&self) -> &str {
        "barrier-cli"
    }
    fn name(&self) -> &str {
        "Barrier CLI"
    }
    fn capabilities(&self) -> AdapterCapabilities {
        AdapterCapabilities {
            plan_mode: false,
            auto_mode: false,
            no_persistence: false,
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
        Arc::new(BarrierSession {
            id: options.mainframe_chat_id,
            project_path: options.project_path,
            gate: Arc::clone(&self.gate),
            spawned: Arc::clone(&self.spawned),
            interrupts: Arc::clone(&self.interrupts),
        })
    }
    fn kill_all(&self) {}
}

struct BarrierSession {
    id: String,
    project_path: String,
    gate: Arc<Mutex<Option<tokio::sync::oneshot::Receiver<()>>>>,
    spawned: Arc<AtomicBool>,
    interrupts: InterruptLog,
}

impl AdapterSession for BarrierSession {
    fn id(&self) -> &str {
        &self.id
    }
    fn adapter_id(&self) -> &str {
        "barrier-cli"
    }
    fn project_path(&self) -> &str {
        &self.project_path
    }
    fn is_spawned(&self) -> bool {
        true
    }

    /// Blocks until the test releases the gate — the one call this adapter
    /// exists for.
    fn spawn(
        &self,
        _options: Option<SessionSpawnOptions>,
        _sink: Option<Arc<dyn mainframe_adapter_api::SessionSink>>,
    ) -> BoxFuture<'_, Result<AdapterProcess, AdapterError>> {
        Box::pin(async move {
            let rx = self.gate.lock().unwrap_or_else(|e| e.into_inner()).take();
            if let Some(rx) = rx {
                let _ = rx.await;
            }
            self.spawned.store(true, Ordering::SeqCst);
            Ok(AdapterProcess {
                id: self.id.clone(),
                adapter_id: "barrier-cli".to_string(),
                chat_id: self.id.clone(),
                pid: 0,
                status: AdapterProcessStatus::Running,
                project_path: self.project_path.clone(),
                model: None,
            })
        })
    }
    fn kill(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
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
        Box::pin(async { Ok(()) })
    }
    fn respond_to_permission(
        &self,
        _response: ControlResponse,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }
    fn interrupt(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async {
            self.interrupts
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push(self.spawned.load(Ordering::SeqCst));
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
        ContextFiles {
            global: Vec::new(),
            project: Vec::new(),
        }
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
        Box::pin(async { Ok(()) })
    }
}
