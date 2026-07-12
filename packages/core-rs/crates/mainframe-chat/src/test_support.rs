//! Test-only doubles shared by the chat leaf-manager unit tests.
//!
//! Not a port of any TS file: the TS tests build `Partial<AdapterSession>` inline
//! (structural typing). Rust needs a concrete `dyn AdapterSession` double, so the
//! shared `FakeSession` lives here to avoid re-stubbing ~20 trait methods per test.

use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

use mainframe_adapter_api::{
    AdapterError, AdapterSession, BoxFuture, ContextFiles, ImageInput, SessionSink,
    StopBackgroundTaskResult,
};
use mainframe_types::adapter::{AdapterProcess, ControlResponse, SessionSpawnOptions};
use mainframe_types::chat::{Chat, ChatMessage, ChatStatus};
use mainframe_types::context::SkillFileEntry;
use mainframe_types::settings::ExecutionMode;

use std::sync::Arc;

/// A configurable `AdapterSession` double that records the calls the chat leaf
/// managers make (`kill`, `setModel`, `setPermissionMode`, `setPlanMode`).
#[derive(Default)]
pub struct FakeSession {
    pub spawned: bool,
    pub activity: Option<i64>,
    pub kill_count: AtomicUsize,
    pub set_model_calls: Mutex<Vec<String>>,
    pub set_permission_mode_calls: Mutex<Vec<ExecutionMode>>,
    pub set_plan_mode_calls: Mutex<Vec<bool>>,
    /// When `false`, the corresponding setter resolves to `Err` (CLI rejected).
    pub set_model_ok: bool,
    pub set_permission_mode_ok: bool,
    pub set_plan_mode_ok: bool,
    /// Configurable history returned by `load_history` (empty by default).
    pub history: Vec<ChatMessage>,
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
        self.spawned
    }
    fn last_activity_at(&self) -> Option<i64> {
        self.activity
    }

    fn spawn(
        &self,
        _options: Option<SessionSpawnOptions>,
        _sink: Option<Arc<dyn SessionSink>>,
    ) -> BoxFuture<'_, Result<AdapterProcess, AdapterError>> {
        err("unused")
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
        ok()
    }
    fn interrupt(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        ok()
    }
    fn set_model(&self, model: String) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.set_model_calls.lock().unwrap().push(model);
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
        let history = self.history.clone();
        Box::pin(async move { Ok(history) })
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

/// A minimal `Chat` for tests that only care about a few fields.
pub fn test_chat(id: &str) -> Chat {
    Chat {
        id: id.to_string(),
        adapter_id: "claude".to_string(),
        project_id: "p1".to_string(),
        title: None,
        claude_session_id: None,
        session_file_path: None,
        model: Some("old-model".to_string()),
        permission_mode: Some(ExecutionMode::Default),
        plan_mode: None,
        status: ChatStatus::Active,
        created_at: String::new(),
        updated_at: String::new(),
        total_cost: 0.0,
        total_tokens_input: 0,
        total_tokens_output: 0,
        last_context_tokens_input: 0,
        context_files: None,
        mentions: None,
        modified_files: None,
        worktree_path: None,
        branch_name: None,
        process_state: None,
        last_context_total_tokens: None,
        last_context_max_tokens: None,
        display_status: None,
        is_running: None,
        background_activity: None,
        worktree_missing: None,
        transcript_missing: None,
        todos: None,
        pinned: None,
        effort: None,
        fast: None,
        ultracode: None,
        adaptive_thinking: None,
        detected_prs: None,
        tags: None,
    }
}

// Not a port; test scaffolding only. No PORT STATUS trailer.
