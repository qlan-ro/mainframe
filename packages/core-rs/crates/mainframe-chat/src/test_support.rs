//! Test-only doubles shared by the chat leaf-manager unit tests.
//!
//! Tests need a concrete `dyn AdapterSession` double, so the shared `FakeSession`
//! lives here to avoid re-stubbing ~20 trait methods per test.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use mainframe_adapter_api::{
    AdapterError, AdapterSession, BoxFuture, ContextFiles, ImageInput, SessionSink,
    StopBackgroundTaskResult,
};
use mainframe_types::adapter::{
    AdapterProcess, AdapterProcessStatus, ControlResponse, SessionSpawnOptions,
};
use mainframe_types::chat::ChatMessage;
use mainframe_types::context::SkillFileEntry;
use mainframe_types::settings::ExecutionMode;

use std::path::PathBuf;
use std::sync::Arc;

/// A configurable `AdapterSession` double that records the calls the chat leaf
/// managers make (`kill`, `setModel`, `setPermissionMode`, `setPlanMode`).
#[derive(Default)]
pub struct FakeSession {
    pub spawned: bool,
    pub activity: Option<i64>,
    /// Overrides `activity` once set — lets a test bump "last activity" after
    /// construction (AC4's activity-injected-after-selection race), which a
    /// plain `Option<i64>` field can't do without interior mutability.
    pub(crate) activity_override: Mutex<Option<i64>>,
    pub kill_count: AtomicUsize,
    pub set_model_calls: Mutex<Vec<String>>,
    pub set_permission_mode_calls: Mutex<Vec<ExecutionMode>>,
    pub set_plan_mode_calls: Mutex<Vec<bool>>,
    /// When `false`, the corresponding setter resolves to `Err` (CLI rejected).
    pub set_model_ok: bool,
    pub model_requires_restart: bool,
    pub model_gate: Option<Arc<(tokio::sync::Notify, tokio::sync::Notify)>>,
    pub set_permission_mode_ok: bool,
    pub set_plan_mode_ok: bool,
    /// Configurable history returned by `load_history` (empty by default).
    pub history: Vec<ChatMessage>,
    /// When set, every `load_history` call bumps it — how a test proves a
    /// path loads the transcript once rather than twice.
    pub history_loads: Option<Arc<AtomicUsize>>,
    /// `AdapterSession::history_sources` — empty by default (matching the
    /// trait's "do not cache" default), so only a test that opts in by
    /// setting real, stat-able paths here ever exercises the history
    /// snapshot cache.
    pub history_sources: Vec<PathBuf>,
    /// Fires synchronously inside `respond_to_permission`, before it resolves —
    /// lets a test land a concurrent mutation (e.g. a cancel) "during" the CLI
    /// round-trip an `.await` on this call represents.
    pub on_respond_to_permission: Option<Arc<dyn Fn() + Send + Sync>>,
    /// When `true`, `spawn` succeeds (and `is_spawned` flips true after it) —
    /// otherwise `spawn` errors with `"unused"`, today's default for every
    /// caller that never actually spawns. Lets a resume test observe a real
    /// post-spawn `send_message` instead of failing at `require_live_session`.
    pub spawn_ok: bool,
    pub(crate) spawned_after_spawn: AtomicBool,
    /// The options of the last `spawn` call, recorded before `spawn_ok` is
    /// consulted so a test can inspect what a spawn would have carried.
    pub spawn_options: Mutex<Option<SessionSpawnOptions>>,
}

impl FakeSession {
    pub fn spawned() -> Self {
        Self {
            spawned: true,
            set_model_ok: true,
            set_permission_mode_ok: true,
            set_plan_mode_ok: true,
            ..Self::default()
        }
    }

    pub fn with_activity(spawned: bool, activity: Option<i64>) -> Arc<Self> {
        Arc::new(Self {
            spawned,
            activity,
            ..Self::default()
        })
    }

    pub fn kills(&self) -> usize {
        self.kill_count.load(Ordering::SeqCst)
    }

    /// Bump "last activity" to `ts` — see `activity_override`.
    pub fn bump_activity(&self, ts: i64) {
        *self.activity_override.lock().unwrap() = Some(ts);
    }
}

fn ok<'a>() -> BoxFuture<'a, Result<(), AdapterError>> {
    Box::pin(async { Ok(()) })
}

fn err<'a, T: Send + 'a>(msg: &str) -> BoxFuture<'a, Result<T, AdapterError>> {
    let msg = msg.to_string();
    Box::pin(async move { Err(AdapterError::Message(msg)) })
}

impl AdapterSession for FakeSession {
    fn id(&self) -> &str {
        "sess"
    }
    fn adapter_id(&self) -> &str {
        "claude"
    }
    fn project_path(&self) -> &str {
        "/tmp"
    }
    fn is_spawned(&self) -> bool {
        self.spawned || self.spawned_after_spawn.load(Ordering::SeqCst)
    }
    fn model_requires_restart(&self, _model: &str) -> bool {
        self.model_requires_restart
    }
    fn last_activity_at(&self) -> Option<i64> {
        self.activity_override.lock().unwrap().or(self.activity)
    }

    fn spawn(
        &self,
        options: Option<SessionSpawnOptions>,
        _sink: Option<Arc<dyn SessionSink>>,
    ) -> BoxFuture<'_, Result<AdapterProcess, AdapterError>> {
        *self.spawn_options.lock().unwrap() = options;
        if !self.spawn_ok {
            return err("unused");
        }
        self.spawned_after_spawn.store(true, Ordering::SeqCst);
        Box::pin(async {
            Ok(AdapterProcess {
                id: "sess".to_string(),
                adapter_id: "claude".to_string(),
                chat_id: "c1".to_string(),
                pid: 1,
                status: AdapterProcessStatus::Running,
                project_path: "/tmp".to_string(),
                model: None,
            })
        })
    }
    fn kill(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.kill_count.fetch_add(1, Ordering::SeqCst);
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
        if let Some(hook) = &self.on_respond_to_permission {
            hook();
        }
        ok()
    }
    fn interrupt(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        ok()
    }
    fn set_model(&self, model: String) -> BoxFuture<'_, Result<(), AdapterError>> {
        let gated = model == "default";
        self.set_model_calls.lock().unwrap().push(model);
        if gated && let Some(gate) = &self.model_gate {
            return Box::pin(async move {
                gate.0.notify_one();
                gate.1.notified().await;
                Ok(())
            });
        }
        if self.set_model_ok {
            ok()
        } else {
            err("set_model failed: timeout")
        }
    }
    fn set_permission_mode(&self, mode: ExecutionMode) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.set_permission_mode_calls.lock().unwrap().push(mode);
        if self.set_permission_mode_ok {
            ok()
        } else {
            err("set_permission_mode failed")
        }
    }
    fn set_plan_mode(&self, on: bool) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.set_plan_mode_calls.lock().unwrap().push(on);
        if self.set_plan_mode_ok {
            ok()
        } else {
            err("set_plan_mode failed")
        }
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
        if let Some(loads) = &self.history_loads {
            loads.fetch_add(1, Ordering::SeqCst);
        }
        let history = self.history.clone();
        Box::pin(async move { Ok(history) })
    }
    fn history_sources(&self) -> BoxFuture<'_, Vec<PathBuf>> {
        let sources = self.history_sources.clone();
        Box::pin(async move { sources })
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
}

pub use crate::test_support_chat::test_chat;

/// `mainframe-chat` and `mainframe-server` both depend on `mainframe-runtime`
/// already, so the tracing capture helper lives there and is re-exported here
/// for the crate's existing `crate::test_support::LogCapture` call sites.
pub use mainframe_runtime::log_capture::LogCapture;
