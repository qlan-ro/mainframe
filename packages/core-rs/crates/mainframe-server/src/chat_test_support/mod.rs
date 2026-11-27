//! A minimal `Adapter`/`AdapterSession` pair that actually "spawns" (unlike
//! `routes/session_transcripts.rs`'s `StubAdapter`, whose `create_session` is
//! `unreachable!`) — for route tests that need `ctx.chat.chat_manager` wired to a
//! real `ChatManager` and drive it through a create/start round trip without
//! touching a real CLI process.
#![cfg(test)]

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

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
use mainframe_types::transcript::TranscriptLocation;

mod app_ctx;

pub(crate) use app_ctx::build_test_context;

static NEXT_SESSION_ID: AtomicUsize = AtomicUsize::new(1);

/// Registers under whatever `id` it is built with (route tests use `"claude"`
/// to match their bodies' `adapterId`). `no_persistence` mirrors the
/// registry capability the chat spawn decision reads.
pub(crate) struct StubAdapter {
    id: String,
    no_persistence: bool,
    pub(crate) transcript_location: Option<TranscriptLocation>,
    pub(crate) conflicts: Vec<String>,
    pub(crate) tool_reader: Option<Arc<dyn Adapter>>,
    /// How many `StubSession::kill` calls this adapter's sessions have seen
    /// (shared across every session it hands out) — lets a caller prove a
    /// project/chat teardown actually stopped a live process.
    pub(crate) kills: Arc<AtomicUsize>,
    /// Set by [`StubAdapter::live`]: sessions stay spawned, keep their sink so
    /// a test can raise session events, and record permission answers.
    pub(crate) live: Option<Arc<LiveStub>>,
    /// What every session's `load_subagent_history` returns; `None` fails it.
    pub(crate) subagent_rows: Option<Arc<Vec<ChatMessage>>>,
}

/// What a live stub's sessions share with the test driving them.
#[derive(Default)]
pub(crate) struct LiveStub {
    sinks: Mutex<HashMap<String, Arc<dyn SessionSink>>>,
    answers: Mutex<Vec<ControlResponse>>,
}

impl LiveStub {
    /// The sink of the session spawned for `chat_id`.
    pub(crate) fn sink(&self, chat_id: &str) -> Arc<dyn SessionSink> {
        self.sinks.lock().unwrap()[chat_id].clone()
    }

    /// Every permission answer the sessions received, oldest first.
    pub(crate) fn answers(&self) -> Vec<ControlResponse> {
        self.answers.lock().unwrap().clone()
    }
}

impl StubAdapter {
    pub(crate) fn new(id: &str, no_persistence: bool) -> Arc<Self> {
        Arc::new(Self {
            id: id.to_string(),
            no_persistence,
            transcript_location: None,
            tool_reader: None,
            conflicts: Vec::new(),
            kills: Arc::new(AtomicUsize::new(0)),
            live: None,
            subagent_rows: None,
        })
    }

    pub(crate) fn live(id: &str) -> Arc<Self> {
        Arc::new(Self {
            id: id.to_string(),
            no_persistence: false,
            transcript_location: None,
            tool_reader: None,
            conflicts: Vec::new(),
            kills: Arc::new(AtomicUsize::new(0)),
            live: Some(Arc::default()),
            subagent_rows: None,
        })
    }
}

impl Adapter for StubAdapter {
    fn config_conflicts(&self) -> BoxFuture<'_, Vec<String>> {
        Box::pin(async { self.conflicts.clone() })
    }

    fn read_tool_result(&self, path: String, tool_id: String) -> BoxFuture<'_, Option<String>> {
        Box::pin(async move {
            match &self.tool_reader {
                Some(reader) => reader.read_tool_result(path, tool_id).await,
                None => None,
            }
        })
    }

    fn id(&self) -> &str {
        &self.id
    }
    fn name(&self) -> &str {
        &self.id
    }
    fn locate_transcript(
        &self,
        _session_id: String,
        _project_path: String,
        _session_file_path: Option<String>,
    ) -> BoxFuture<'_, Result<Option<TranscriptLocation>, AdapterError>> {
        let location = self.transcript_location.clone();
        Box::pin(async move { Ok(location) })
    }
    fn capabilities(&self) -> AdapterCapabilities {
        AdapterCapabilities {
            plan_mode: false,
            no_persistence: self.no_persistence,
            fork: false,
            ..AdapterCapabilities::default()
        }
    }
    fn is_installed(&self) -> BoxFuture<'_, Result<bool, AdapterError>> {
        Box::pin(async { Ok(true) })
    }
    fn get_version(&self) -> BoxFuture<'_, Result<Option<String>, AdapterError>> {
        Box::pin(async { Ok(None) })
    }
    fn catalog(&self) -> Vec<AdapterModel> {
        Vec::new()
    }
    fn create_session(&self, options: SessionOptions) -> Arc<dyn AdapterSession> {
        let id = options.chat_id.clone().unwrap_or_else(|| {
            let n = NEXT_SESSION_ID.fetch_add(1, Ordering::SeqCst);
            format!("stub-sess-{n}")
        });
        Arc::new(StubSession {
            chat_id: options.mainframe_chat_id,
            id,
            adapter_id: self.id.clone(),
            project_path: options.project_path,
            kills: self.kills.clone(),
            live: self.live.clone(),
            spawned: AtomicBool::new(false),
            subagent_rows: self.subagent_rows.clone(),
        })
    }
    fn kill_all(&self) {}
}

struct StubSession {
    chat_id: String,
    id: String,
    adapter_id: String,
    project_path: String,
    kills: Arc<AtomicUsize>,
    live: Option<Arc<LiveStub>>,
    spawned: AtomicBool,
    subagent_rows: Option<Arc<Vec<ChatMessage>>>,
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
        self.spawned.load(Ordering::SeqCst)
    }
    fn spawn(
        &self,
        _options: Option<SessionSpawnOptions>,
        sink: Option<Arc<dyn mainframe_adapter_api::SessionSink>>,
    ) -> BoxFuture<'_, Result<AdapterProcess, AdapterError>> {
        Box::pin(async move {
            if let Some(sink) = sink {
                sink.on_init(&self.id);
                if let Some(live) = &self.live {
                    live.sinks
                        .lock()
                        .unwrap()
                        .insert(self.chat_id.clone(), sink);
                    self.spawned.store(true, Ordering::SeqCst);
                }
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
        response: ControlResponse,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        if let Some(live) = &self.live {
            live.answers.lock().unwrap().push(response);
        }
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
    fn load_subagent_history(
        &self,
        _agent_id: String,
    ) -> BoxFuture<'_, Result<Arc<Vec<ChatMessage>>, AdapterError>> {
        let rows = self.subagent_rows.clone();
        Box::pin(async move { rows.ok_or(AdapterError::Unavailable("no sub-agent rows")) })
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
