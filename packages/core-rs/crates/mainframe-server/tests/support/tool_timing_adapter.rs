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

#[derive(Default)]
pub struct ToolTimingAdapter {
    sink: Arc<Mutex<Option<Arc<dyn SessionSink>>>>,
}

impl ToolTimingAdapter {
    pub fn sink(&self) -> Arc<dyn SessionSink> {
        self.sink.lock().unwrap().clone().expect("session spawned")
    }
}

impl Adapter for ToolTimingAdapter {
    fn id(&self) -> &str {
        "tool-timing-cli"
    }
    fn name(&self) -> &str {
        "Tool timing CLI"
    }
    fn capabilities(&self) -> AdapterCapabilities {
        AdapterCapabilities {
            plan_mode: false,
            auto_mode: false,
            no_persistence: false,
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
        Arc::new(ToolTimingSession {
            id: options.mainframe_chat_id,
            project_path: options.project_path,
            sink: Arc::clone(&self.sink),
        })
    }
    fn kill_all(&self) {}
    fn get_tool_categories(&self) -> Option<mainframe_types::display::ToolCategories> {
        Some(mainframe_types::display::ToolCategories {
            subagent: std::collections::HashSet::from(["Task".into()]),
            explore: Default::default(),
            hidden: Default::default(),
            progress: Default::default(),
        })
    }
}

struct ToolTimingSession {
    id: String,
    project_path: String,
    sink: Arc<Mutex<Option<Arc<dyn SessionSink>>>>,
}

impl AdapterSession for ToolTimingSession {
    fn id(&self) -> &str {
        &self.id
    }
    fn adapter_id(&self) -> &str {
        "tool-timing-cli"
    }
    fn project_path(&self) -> &str {
        &self.project_path
    }
    fn is_spawned(&self) -> bool {
        true
    }

    fn spawn(
        &self,
        _options: Option<SessionSpawnOptions>,
        sink: Option<Arc<dyn SessionSink>>,
    ) -> BoxFuture<'_, Result<AdapterProcess, AdapterError>> {
        Box::pin(async move {
            *self.sink.lock().unwrap() = sink;
            Ok(AdapterProcess {
                id: self.id.clone(),
                adapter_id: "tool-timing-cli".to_string(),
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
        Box::pin(async { Ok(()) })
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
