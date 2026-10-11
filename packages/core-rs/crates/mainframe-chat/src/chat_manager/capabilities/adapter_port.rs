use super::*;

pub trait AdapterPort: Send + Sync {
    fn get_tool_categories(&self, chat_id: &str) -> Option<ToolCategories>;

    fn prepare_messages_for_client(
        &self,
        raw: &[ChatMessage],
        categories: Option<&ToolCategories>,
    ) -> Vec<DisplayMessage>;

    fn display_projector(&self) -> Box<dyn mainframe_display::DisplayProjector>;

    fn strip_command_tags(&self, text: &str) -> String;

    fn initial_transcript_path(
        &self,
        adapter_id: &str,
        session_id: &str,
        cwd: &str,
    ) -> Option<String>;

    fn create_session(
        &self,
        adapter_id: &str,
        options: mainframe_types::adapter::SessionOptions,
    ) -> Option<Arc<dyn AdapterSession>>;

    fn create_plan_mode_handler(&self, adapter_id: &str) -> Option<Arc<dyn PlanModeActionHandler>>;

    fn scan_loaded_history<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()>;

    fn resolve_tuning<'a>(
        &'a self,
        chat_id: &'a str,
    ) -> BoxFuture<'a, Option<mainframe_types::chat::ResolvedTuning>>;

    fn generate_title<'a>(
        &'a self,
        adapter_id: &'a str,
        content: &'a str,
        binary: &'a str,
    ) -> BoxFuture<'a, Option<String>>;

    fn on_provider_quota(&self, _adapter_id: &str, _quota: ProviderQuota) {}

    fn locate_transcript<'a>(
        &'a self,
        adapter_id: &'a str,
        session_id: &'a str,
        project_path: &'a str,
        session_file_path: Option<&'a str>,
    ) -> BoxFuture<'a, Option<mainframe_types::transcript::TranscriptLocation>>;

    fn adapter_supports_no_persistence(&self, adapter_id: &str) -> bool;

    fn adapter_fork_info(&self, adapter_id: &str) -> AdapterForkInfo {
        AdapterForkInfo {
            name: adapter_id.to_string(),
            fork: false,
            unavailable_reason: None,
        }
    }

    fn pin_fork_point<'a>(
        &'a self,
        adapter_id: &'a str,
        request: ForkPinRequest,
    ) -> BoxFuture<'a, Result<ForkSource, ForkPinError>> {
        let _ = (adapter_id, request);
        Box::pin(async { Err(ForkPinError::Unsupported) })
    }

    fn adapter_info(&self, adapter_id: &str) -> Option<mainframe_types::adapter::AdapterInfo> {
        let _ = adapter_id;
        None
    }

    fn orchestration_mcp_attached(&self, chat_id: &str) -> bool {
        let _ = chat_id;
        false
    }
}
