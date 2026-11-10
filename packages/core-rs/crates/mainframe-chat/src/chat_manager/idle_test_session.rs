use super::*;
use mainframe_adapter_api::{ContextFiles, SessionSink};
use mainframe_types::sync::LockExt as _;
use mainframe_types::{
    adapter::{AdapterProcess, SessionSpawnOptions},
    compaction::*,
    settings::ExecutionMode,
};
use std::sync::atomic::{AtomicBool, Ordering};

pub(super) struct IdleTestSession {
    pub inner: crate::test_support::FakeSession,
    pub supported: bool,
    pub class: CacheClassification,
    pub ready: AtomicBool,
    pub requests: Mutex<Vec<NativeCompactionRequest>>,
    pub sent: Mutex<Vec<(String, Option<String>)>>,
    pub sink: Mutex<Option<Arc<dyn SessionSink>>>,
    pub started: tokio::sync::Notify,
    pub finish: tokio::sync::Notify,
    pub fail: bool,
    pub legacy: bool,
}
impl IdleTestSession {
    pub fn new() -> Self {
        Self {
            inner: crate::test_support::FakeSession {
                spawned: true,
                activity: Some(100),
                ..Default::default()
            },
            supported: true,
            class: CacheClassification::Claude1h,
            ready: AtomicBool::new(true),
            requests: Mutex::new(Vec::new()),
            sent: Mutex::new(Vec::new()),
            sink: Mutex::new(None),
            started: tokio::sync::Notify::new(),
            finish: tokio::sync::Notify::new(),
            fail: false,
            legacy: false,
        }
    }
}
impl AdapterSession for IdleTestSession {
    fn stop_background_task(
        &self,
        id: String,
    ) -> BoxFuture<'_, Result<mainframe_adapter_api::StopBackgroundTaskResult, AdapterError>> {
        self.inner.stop_background_task(id)
    }
    fn supports_native_compaction(&self) -> bool {
        self.supported
    }
    fn cache_classification(&self) -> CacheClassification {
        self.class
    }
    fn ready_for_input(&self) -> bool {
        self.ready.load(Ordering::SeqCst)
    }
    fn native_compact(
        &self,
        request: NativeCompactionRequest,
    ) -> BoxFuture<'_, Result<CompactionMetadata, AdapterError>> {
        Box::pin(async move {
            self.requests.lock_recover().push(request.clone());

            let mut metadata = request.metadata((!self.legacy).then_some("boundary"));
            if self.adapter_id() == "codex" {
                metadata.command_uuid = None;
            }
            metadata.before_tokens = Some(20_000);
            metadata.after_tokens = Some(2_000);
            if !self.fail
                && let Some(sink) = self.sink.lock_recover().as_ref()
            {
                sink.on_compact_with_metadata(metadata.clone());
            }
            self.started.notify_one();
            self.finish.notified().await;
            if self.fail {
                return Err(AdapterError::Message("test failure".into()));
            }
            Ok(metadata)
        })
    }
    fn id(&self) -> &str {
        self.inner.id()
    }
    fn adapter_id(&self) -> &str {
        self.inner.adapter_id()
    }
    fn project_path(&self) -> &str {
        self.inner.project_path()
    }
    fn is_spawned(&self) -> bool {
        self.inner.is_spawned()
    }
    fn last_activity_at(&self) -> Option<i64> {
        self.inner.last_activity_at()
    }
    fn spawn(
        &self,
        options: Option<SessionSpawnOptions>,
        sink: Option<Arc<dyn SessionSink>>,
    ) -> BoxFuture<'_, Result<AdapterProcess, AdapterError>> {
        self.inner.spawn(options, sink)
    }
    fn kill(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.inner.kill()
    }
    fn get_process_info(&self) -> Option<AdapterProcess> {
        self.inner.get_process_info()
    }
    fn send_message(
        &self,
        message: String,
        _images: Vec<ImageInput>,
        uuid: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.sent.lock_recover().push((message, uuid));
        Box::pin(async { Ok(()) })
    }
    fn respond_to_permission(
        &self,
        response: ControlResponse,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.inner.respond_to_permission(response)
    }
    fn interrupt(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.inner.interrupt()
    }
    fn set_model(&self, model: String) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.inner.set_model(model)
    }
    fn set_permission_mode(&self, mode: ExecutionMode) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.inner.set_permission_mode(mode)
    }
    fn set_plan_mode(&self, on: bool) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.inner.set_plan_mode(on)
    }
    fn send_command(
        &self,
        command: String,
        args: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.inner.send_command(command, args)
    }
    fn cancel_queued_message(&self, uuid: String) -> BoxFuture<'_, Result<bool, AdapterError>> {
        self.inner.cancel_queued_message(uuid)
    }
    fn get_context_files(&self) -> ContextFiles {
        self.inner.get_context_files()
    }
    fn load_history(&self) -> BoxFuture<'_, Result<Vec<ChatMessage>, AdapterError>> {
        self.inner.load_history()
    }
    fn extract_plan_files(&self) -> BoxFuture<'_, Result<Vec<String>, AdapterError>> {
        self.inner.extract_plan_files()
    }
    fn extract_skill_files(&self) -> BoxFuture<'_, Result<Vec<SkillFileEntry>, AdapterError>> {
        self.inner.extract_skill_files()
    }
}

pub(super) fn reanchor(deps: &crate::test_support::FakeDeps, completed: Option<i64>) {
    deps.idle_run_begin("c", "fixture-reset").unwrap();
    deps.idle_run_begin("c", "run").unwrap();
    deps.idle_run_complete("c", "run", completed).unwrap();
}
