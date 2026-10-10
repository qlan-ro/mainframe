use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU8, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::Duration;

use nanoid::nanoid;
use serde_json::{Value, json};
use tokio::sync::{Notify, mpsc};

use mainframe_adapter_api::{
    AdapterError, AdapterSession, BoxFuture, ContextFiles, ImageInput, SessionSink,
    StopBackgroundTaskResult,
};
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_claude_workflows::store::ClaudeWorkflowStore;
use mainframe_runtime::ResolvedPath;
use mainframe_types::adapter::{
    AdapterProcess, AdapterProcessStatus, ControlBehavior, ControlResponse, MessageUsage,
    SessionOptions, SessionSpawnOptions,
};
use mainframe_types::chat::{ChatMessage, ResolvedTuning};
use mainframe_types::context::SkillFileEntry;
use mainframe_types::settings::ExecutionMode;

use crate::cliproxy::{self, CliProxyEnv};
use crate::constants::MAINFRAME_SYSTEM_PROMPT_APPEND;
use crate::context_files::collect_claude_context_files;
use crate::events::{handle_stderr, handle_stdout};
use crate::session_control::{ControlRequestChannel, SendAwaitingOpts, StdinTx};
use crate::task_events::ClaudeTaskEvents;
use crate::tuning::tuning_to_flag_settings;

pub struct ClaudeSession {
    pub id: String,
    pub project_path: String,
    resume_session_id: Option<String>,
    session_file_path: Option<String>,
    fork_source: Option<mainframe_types::adapter::ForkSource>,
    on_exit: Mutex<Option<Box<dyn Fn() + Send + Sync>>>,
    pub control: Arc<ControlRequestChannel>,
    base_permission_mode: Mutex<String>,
    executable: Mutex<String>,
    shared: Arc<SharedSurface>,
    pub(crate) state: Arc<Mutex<ClaudeSessionState>>,
    stdin_tx: Mutex<Option<StdinTx>>,
    weak_self: OnceLock<Weak<ClaudeSession>>,
    resolved_path: ResolvedPath,
}

impl ClaudeSession {
    pub fn new(
        options: SessionOptions,
        on_exit: Option<Box<dyn Fn() + Send + Sync>>,
        background_tasks: Arc<BackgroundTaskTracker>,
        workflow_store: Arc<ClaudeWorkflowStore>,
        resolved_path: ResolvedPath,
    ) -> Self {
        let id = nanoid!();
        let control = Arc::new(ControlRequestChannel::new(id.clone()));
        let chat_id = options.chat_id.clone().unwrap_or_default();
        ClaudeSession {
            id,
            project_path: options.project_path.clone(),
            resume_session_id: options.chat_id,
            session_file_path: options.session_file_path,
            fork_source: options.fork_source,
            on_exit: Mutex::new(on_exit),
            control,
            base_permission_mode: Mutex::new("default".to_string()),
            executable: Mutex::new("claude".to_string()),
            shared: Arc::new(SharedSurface {
                pid: AtomicU32::new(0),
                status: AtomicU8::new(status_to_u8(AdapterProcessStatus::Starting)),
                last_activity_ms: AtomicI64::new(now_ms()),
                endpoint: AtomicBool::new(false),
            }),
            state: Arc::new(Mutex::new(ClaudeSessionState {
                chat_id,
                mainframe_chat_id: options.mainframe_chat_id,
                real_project_path: options.project_path,
                buffer: String::new(),
                last_assistant_usage: None,
                child: None,
                active_tasks: HashMap::new(),
                interrupt_timer: None,
                skill_path_cache: HashMap::new(),
                task_v2_events: Vec::new(),
                task_events: ClaudeTaskEvents::new(background_tasks, workflow_store),
                partial: crate::partial_stream::PartialMessageState::default(),
                seen_api_message_ids: std::collections::HashSet::new(),
                presentation: Default::default(),
            })),
            stdin_tx: Mutex::new(None),
            weak_self: OnceLock::new(),
            resolved_path,
        }
    }
    pub fn init_weak(self: &Arc<Self>) {
        let _ = self.weak_self.set(Arc::downgrade(self));
    }
    pub fn set_on_exit(&self, cb: Box<dyn Fn() + Send + Sync>) {
        *self.on_exit.lock().unwrap_or_else(|e| e.into_inner()) = Some(cb);
    }

    fn state(&self) -> std::sync::MutexGuard<'_, ClaudeSessionState> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn stdin_clone(&self) -> Option<StdinTx> {
        self.stdin_tx
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
    fn available_stdin(&self) -> Option<StdinTx> {
        match self.stdin_clone() {
            Some(tx) if !tx.is_closed() => Some(tx),
            _ => None,
        }
    }

    pub(crate) fn bump_last_activity(&self) {
        self.shared
            .last_activity_ms
            .store(now_ms(), Ordering::SeqCst);
    }

    pub(crate) fn set_status(&self, s: AdapterProcessStatus) {
        self.shared.status.store(status_to_u8(s), Ordering::SeqCst);
    }

    pub fn is_spawned(&self) -> bool {
        self.state().child.is_some()
    }
    pub(crate) fn is_endpoint_session(&self) -> bool {
        self.shared.endpoint.load(Ordering::SeqCst)
    }

    pub fn last_activity_at(&self) -> i64 {
        self.shared.last_activity_ms.load(Ordering::SeqCst)
    }

    pub fn get_process_info(&self) -> Option<AdapterProcess> {
        let st = self.state();
        st.child.as_ref()?;
        Some(AdapterProcess {
            id: self.id.clone(),
            adapter_id: "claude".to_string(),
            chat_id: st.chat_id.clone(),
            pid: self.shared.pid.load(Ordering::SeqCst) as i64,
            status: u8_to_status(self.shared.status.load(Ordering::SeqCst)),
            project_path: self.project_path.clone(),
            model: None,
        })
    }
    #[cfg(test)]
    pub(crate) fn set_child_for_test(&self, child: ChildHandle) {
        self.state().child = Some(child);
    }
    #[cfg(test)]
    pub(crate) fn set_endpoint_for_test(&self) {
        self.shared.endpoint.store(true, Ordering::SeqCst);
    }
    #[cfg(test)]
    pub(crate) fn set_stdin_for_test(&self, tx: Option<StdinTx>) {
        *self.stdin_tx.lock().unwrap() = tx;
    }
    #[cfg(test)]
    pub(crate) fn chat_id(&self) -> String {
        self.state().chat_id.clone()
    }
    #[cfg(test)]
    pub(crate) fn mainframe_chat_id(&self) -> String {
        self.state().mainframe_chat_id.clone()
    }
}

#[cfg(test)]
mod model_tests;

#[cfg(test)]
#[path = "session_tests/support.rs"]
mod tests;

#[path = "session_adapter.rs"]
mod adapter;
#[path = "session_controls.rs"]
mod controls;
#[path = "session_lifecycle.rs"]
mod lifecycle;
#[cfg(test)]
mod permission_response_tests;
#[path = "session_process.rs"]
mod process;
#[path = "session_prompt.rs"]
mod prompt;
#[path = "session_spawn.rs"]
mod spawn;
#[path = "session_state.rs"]
mod state;
use controls::{execution_mode_cli, has_cancelled_flag, is_terminal_ctrl};
pub use process::{ChildHandle, NullSink, Signal};
#[cfg(test)]
use spawn::{build_args, build_spawn_command};
pub use state::{ActiveTask, ClaudeSessionState};
use state::{SharedSurface, now_ms, status_to_u8, u8_to_status};
