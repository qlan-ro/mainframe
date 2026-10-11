use super::*;
use crate::test_support::test_chat;
use mainframe_adapter_api::{
    ContextFiles, ImageInput, PlanModeActionHandler, SessionSink, StopBackgroundTaskResult,
};
use mainframe_types::adapter::{AdapterProcess, ControlResponse, SessionSpawnOptions};
use mainframe_types::chat::{Chat, ChatStatus, ProcessState};
use mainframe_types::context::SkillFileEntry;
use mainframe_types::http_status::{HttpStatus, StatusKind};
use mainframe_types::settings::ExecutionMode;
use std::sync::atomic::{AtomicUsize, Ordering};

#[path = "chat_manager_tests_chat_surface_wiring.rs"]
mod chat_surface_wiring;
#[path = "chat_manager_tests_fork_chat.rs"]
mod fork_chat;
#[path = "chat_manager_tests_fork_from_message.rs"]
mod fork_from_message;
#[path = "chat_manager_tests_fork_history.rs"]
mod fork_history;
#[path = "chat_manager_tests_fork_segments.rs"]
mod fork_segments;
#[path = "chat_manager_tests_fork_sweep.rs"]
mod fork_sweep;
#[path = "chat_manager_tests_fork_title.rs"]
mod fork_title;
#[path = "chat_manager_tests_history_eviction.rs"]
mod history_eviction;
#[path = "chat_manager_tests_history_snapshot.rs"]
mod history_snapshot;
#[path = "chat_manager_tests_offload.rs"]
mod offload;
#[path = "chat_manager_tests_orchestration.rs"]
mod orchestration;
#[path = "chat_manager_tests_plan_mode.rs"]
mod plan_mode;
#[path = "chat_manager_tests_provider_switch.rs"]
mod provider_switch;
#[path = "chat_manager_tests_resume_overlay.rs"]
mod resume_overlay;
#[path = "chat_manager_tests_resume_snapshot.rs"]
mod resume_snapshot;
#[path = "chat_manager_tests_segment_fake.rs"]
mod segment_fake;
#[path = "chat_manager_tests_side_chat.rs"]
mod side_chat;
#[path = "chat_manager_tests_teardown.rs"]
mod teardown;
#[path = "chat_manager_tests_wire_golden.rs"]
mod wire_golden;

pub(crate) use crate::test_support::FakeDeps;

// ── recording AdapterSession ─────────────────────────────────────────────────

struct RecSession {
    label: String,
    supports_replay_ack: bool,
    cancel_result: bool,
    send_message_calls: Mutex<Vec<(String, Option<String>)>>,
    send_command_calls: Mutex<Vec<(String, Option<String>)>>,
    cancel_calls: Mutex<Vec<String>>,
    order: Arc<Mutex<Vec<String>>>,
    kills: AtomicUsize,
    /// `images.len()` from every `send_message` call, in order.
    images_calls: Mutex<Vec<usize>>,
    /// Every `respond_to_permission` call, in order — pins the plan-mode escalation
    /// double-send.
    responded_calls: Mutex<Vec<ControlResponse>>,
    /// Every `set_permission_mode` call, in order.
    permission_mode_calls: Mutex<Vec<ExecutionMode>>,
    /// Every `steer` call's message, in order. Steering is always supported.
    steer_calls: Mutex<Vec<String>>,
    /// When set, `steer` fails with this message instead of recording the
    /// call (a Codex `turn/steer` rejected because the turn already ended).
    steer_err: Mutex<Option<String>>,
}

impl RecSession {
    fn new(label: &str, supports_replay_ack: bool, cancel_result: bool) -> Arc<Self> {
        Arc::new(Self {
            label: label.to_string(),
            supports_replay_ack,
            cancel_result,
            send_message_calls: Mutex::new(Vec::new()),
            send_command_calls: Mutex::new(Vec::new()),
            cancel_calls: Mutex::new(Vec::new()),
            order: Arc::new(Mutex::new(Vec::new())),
            kills: AtomicUsize::new(0),
            images_calls: Mutex::new(Vec::new()),
            responded_calls: Mutex::new(Vec::new()),
            permission_mode_calls: Mutex::new(Vec::new()),
            steer_calls: Mutex::new(Vec::new()),
            steer_err: Mutex::new(None),
        })
    }
    fn with_order(label: &str, order: Arc<Mutex<Vec<String>>>) -> Arc<Self> {
        Arc::new(Self {
            label: label.to_string(),
            supports_replay_ack: false,
            cancel_result: true,
            send_message_calls: Mutex::new(Vec::new()),
            send_command_calls: Mutex::new(Vec::new()),
            cancel_calls: Mutex::new(Vec::new()),
            order,
            kills: AtomicUsize::new(0),
            images_calls: Mutex::new(Vec::new()),
            responded_calls: Mutex::new(Vec::new()),
            permission_mode_calls: Mutex::new(Vec::new()),
            steer_calls: Mutex::new(Vec::new()),
            steer_err: Mutex::new(None),
        })
    }
}

fn ok<'a>() -> BoxFuture<'a, Result<(), AdapterError>> {
    Box::pin(async { Ok(()) })
}

impl AdapterSession for RecSession {
    fn id(&self) -> &str {
        "sess"
    }
    fn adapter_id(&self) -> &str {
        "mock"
    }
    fn project_path(&self) -> &str {
        "/tmp/test"
    }
    fn is_spawned(&self) -> bool {
        true
    }
    fn supports_replay_ack(&self) -> bool {
        self.supports_replay_ack
    }
    fn spawn(
        &self,
        _options: Option<SessionSpawnOptions>,
        _sink: Option<Arc<dyn SessionSink>>,
    ) -> BoxFuture<'_, Result<AdapterProcess, AdapterError>> {
        Box::pin(async { Err(AdapterError::Message("unused".to_string())) })
    }
    fn kill(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.kills.fetch_add(1, Ordering::SeqCst);
        self.order
            .lock()
            .unwrap()
            .push(format!("sess.kill:{}", self.label));
        ok()
    }
    fn get_process_info(&self) -> Option<AdapterProcess> {
        None
    }
    fn send_message(
        &self,
        message: String,
        images: Vec<ImageInput>,
        uuid: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.images_calls.lock().unwrap().push(images.len());
        self.send_message_calls
            .lock()
            .unwrap()
            .push((message, uuid));
        ok()
    }
    fn supports_steer(&self) -> bool {
        true
    }
    fn steer(
        &self,
        message: String,
        _uuid: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        if let Some(msg) = self.steer_err.lock().unwrap().clone() {
            return Box::pin(async move { Err(AdapterError::Message(msg)) });
        }
        self.steer_calls.lock().unwrap().push(message);
        ok()
    }
    fn respond_to_permission(
        &self,
        response: ControlResponse,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.responded_calls.lock().unwrap().push(response);
        ok()
    }
    fn interrupt(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        ok()
    }
    fn set_model(&self, _model: String) -> BoxFuture<'_, Result<(), AdapterError>> {
        ok()
    }
    fn set_permission_mode(&self, mode: ExecutionMode) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.permission_mode_calls.lock().unwrap().push(mode);
        ok()
    }
    fn set_plan_mode(&self, _on: bool) -> BoxFuture<'_, Result<(), AdapterError>> {
        ok()
    }
    fn send_command(
        &self,
        command: String,
        args: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.send_command_calls
            .lock()
            .unwrap()
            .push((command, args));
        ok()
    }
    fn cancel_queued_message(&self, uuid: String) -> BoxFuture<'_, Result<bool, AdapterError>> {
        self.cancel_calls.lock().unwrap().push(uuid);
        let r = self.cancel_result;
        Box::pin(async move { Ok(r) })
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
}

fn seed_active(mgr: &ChatManager, chat_id: &str, chat: Chat, session: Arc<dyn AdapterSession>) {
    mgr.shared.active_chats.insert(
        chat_id.to_string(),
        Arc::new(Mutex::new(ActiveChat::new(chat, Some(session)))),
    );
}

/// Yields long enough for a `tokio::spawn`ed title-generation task to run to
/// completion on the current-thread test runtime.
async fn settle() {
    for _ in 0..50 {
        tokio::task::yield_now().await;
    }
}

/// Every `title` present in `deps.store.updates` — the store-patch log, not the
/// event stream. Assertions about broadcasts must read `deps.events()` instead.
fn titles_written(deps: &FakeDeps) -> Vec<String> {
    deps.store
        .updates
        .lock()
        .unwrap()
        .iter()
        .filter_map(|(_, patch)| patch.title.clone())
        .collect()
}

fn working_chat(id: &str, title: Option<&str>, working: bool) -> Chat {
    let mut c = test_chat(id);
    c.title = title.map(str::to_string);
    c.process_state = Some(Some(if working {
        ProcessState::Working
    } else {
        ProcessState::Idle
    }));
    c
}
