//! The minimal `Adapter`/`AdapterSession` double for `temporary_chat_lifecycle.rs`.
//!
//! Its session id models the one behavior these tests read: a supplied resume
//! id (`SessionOptions.chat_id: Some(id)`) is kept verbatim, a fresh spawn
//! (`None`) mints a new one — the same shape a real CLI's resume vs. fresh
//! start takes, so "the provider id changed" and "the session was resumed"
//! are directly observable without spawning one.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

/// Process-wide (not per-adapter) so a fresh `TestAdapter` built to model a
/// restart still mints an id distinct from the one before it.
static NEXT_SESSION_ID: AtomicUsize = AtomicUsize::new(1);

use mainframe_adapter_api::{
    Adapter, AdapterError, AdapterSession, BoxFuture, ContextFiles, ImageInput, SessionSink,
    StopBackgroundTaskResult,
};
use mainframe_types::adapter::{
    AdapterCapabilities, AdapterModel, AdapterProcess, AdapterProcessStatus, ControlResponse,
    SessionOptions, SessionSpawnOptions,
};
use mainframe_types::chat::{ChatMessage, ResolvedTuning};
use mainframe_types::context::SkillFileEntry;
use mainframe_types::settings::ExecutionMode;

pub const ADAPTER_ID: &str = "temp-chat-test-cli";

/// `no_persistence` mirrors the registry capability under test; every session
/// it hands out records its id into `spawn_ids` and its cwd into
/// `project_paths` so a test can read what a whole scenario spawned (e.g.
/// before/after a restart).
pub struct TestAdapter {
    no_persistence: bool,
    pub spawn_ids: Arc<Mutex<Vec<String>>>,
    pub project_paths: Arc<Mutex<Vec<String>>>,
}

impl TestAdapter {
    pub fn new(no_persistence: bool) -> Arc<Self> {
        Arc::new(Self {
            no_persistence,
            spawn_ids: Arc::new(Mutex::new(Vec::new())),
            project_paths: Arc::new(Mutex::new(Vec::new())),
        })
    }
}

impl Adapter for TestAdapter {
    fn id(&self) -> &str {
        ADAPTER_ID
    }
    fn name(&self) -> &str {
        "Temp Chat Test CLI"
    }
    fn capabilities(&self) -> AdapterCapabilities {
        AdapterCapabilities {
            plan_mode: false,
            auto_mode: false,
            no_persistence: self.no_persistence,
            fork: false,
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
            format!("sess-{n}")
        });
        self.spawn_ids.lock().unwrap().push(id.clone());
        self.project_paths
            .lock()
            .unwrap()
            .push(options.project_path.clone());
        Arc::new(TestSession {
            id,
            project_path: options.project_path,
            spawned: std::sync::atomic::AtomicBool::new(false),
        })
    }
    fn kill_all(&self) {}
}

struct TestSession {
    id: String,
    project_path: String,
    /// Tracks the real spawn/kill lifecycle (a fresh instance always starts
    /// unspawned — every restart scenario here re-derives its manager rather
    /// than reusing a live session, so that part of the old always-`false`
    /// comment still holds) — but a `send_message`-driven respawn within the
    /// SAME manager (AC 12's "next send after a CLI exit" path) needs a session
    /// that actually reports spawned once `spawn()` has run.
    spawned: std::sync::atomic::AtomicBool,
}

fn ok<'a>() -> BoxFuture<'a, Result<(), AdapterError>> {
    Box::pin(async { Ok(()) })
}

impl AdapterSession for TestSession {
    fn id(&self) -> &str {
        &self.id
    }
    fn adapter_id(&self) -> &str {
        ADAPTER_ID
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
            self.spawned.store(true, Ordering::SeqCst);
            if let Some(sink) = sink {
                sink.on_init(&self.id);
            }
            Ok(AdapterProcess {
                id: self.id.clone(),
                adapter_id: ADAPTER_ID.to_string(),
                chat_id: self.id.clone(),
                pid: 0,
                status: AdapterProcessStatus::Running,
                project_path: self.project_path.clone(),
                model: None,
            })
        })
    }
    fn kill(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.spawned.store(false, Ordering::SeqCst);
        ok()
    }
    fn interrupt(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        // A real CLI exits on SIGINT; model the same "session gone, chat
        // untouched" shape an unexpected exit leaves for `send_message`'s
        // `!session_is_spawned` respawn guard (AC 12, todo #346).
        self.spawned.store(false, Ordering::SeqCst);
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
        ok()
    }
}
