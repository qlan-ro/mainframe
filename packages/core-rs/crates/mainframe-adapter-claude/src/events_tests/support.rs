use super::*;
use crate::session::ClaudeSession;
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_claude_workflows::store::ClaudeWorkflowStore;
use mainframe_types::adapter::SessionOptions;
use mainframe_types::adapter::{ContextUsage, ControlRequest, DetectedPr, MessageMetadata};
use mainframe_types::chat::{MessageContent, TodoItem};
use mainframe_types::context::SkillFileEntry;
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub(super) struct Rec {
    pub(super) init: Vec<String>,
    pub(super) messages: usize,
    pub(super) last_message_metadata: Option<MessageMetadata>,
    pub(super) tool_results: usize,
    pub(super) last_tool_result_vendor_id: Option<String>,
    pub(super) skill_files: Vec<SkillFileEntry>,
    pub(super) skill_loaded: Vec<mainframe_adapter_api::LoadedSkill>,
    pub(super) cli_messages: Vec<String>,
    pub(super) subagent: Vec<(String, Vec<MessageContent>)>,
    pub(super) todos: Vec<Vec<TodoItem>>,
    pub(super) errors: usize,
    pub(super) trust: Vec<String>,
    pub(super) results: usize,
    pub(super) compact: usize,
    pub(super) compact_start: usize,
    pub(super) context_usage: Vec<ContextUsage>,
    pub(super) plan_files: Vec<String>,
    pub(super) prs: Vec<DetectedPr>,
    pub(super) queued: Vec<String>,
    pub(super) permissions: Vec<ControlRequest>,
    pub(super) cancelled: Vec<String>,
    pub(super) provider_quota: Vec<(String, mainframe_types::adapter::ProviderQuota)>,
    pub(super) attention_requests: Vec<String>,
    pub(super) api_retries: Vec<(i64, Option<String>)>,
}

#[derive(Default)]
pub(super) struct RecordingSink {
    pub(super) rec: Mutex<Rec>,
}
impl RecordingSink {
    pub(super) fn r(&self) -> std::sync::MutexGuard<'_, Rec> {
        self.rec.lock().unwrap()
    }
}
impl SessionSink for RecordingSink {
    fn on_init(&self, session_id: &str) {
        self.r().init.push(session_id.to_string());
    }
    fn on_message(&self, _content: Vec<MessageContent>, metadata: Option<MessageMetadata>) {
        let mut r = self.r();
        r.messages += 1;
        r.last_message_metadata = metadata;
    }
    fn on_tool_result(&self, _content: Vec<MessageContent>, vendor_id: Option<String>) {
        let mut r = self.r();
        r.tool_results += 1;
        r.last_tool_result_vendor_id = vendor_id;
    }
    fn on_permission(&self, request: ControlRequest) {
        self.r().permissions.push(request);
    }
    fn on_permission_cancelled(&self, request_id: &str) {
        self.r().cancelled.push(request_id.to_string());
    }
    fn on_result(&self, _data: SessionResult) {
        self.r().results += 1;
    }
    fn on_exit(&self, _code: Option<i32>) {}
    fn on_error(&self, _error: AdapterError) {
        self.r().errors += 1;
    }
    fn on_compact(&self, _vendor_id: Option<&str>) {
        self.r().compact += 1;
    }
    fn on_compact_start(&self) {
        self.r().compact_start += 1;
    }
    fn on_context_usage(&self, usage: ContextUsage) {
        self.r().context_usage.push(usage);
    }
    fn on_plan_file(&self, file_path: &str) {
        self.r().plan_files.push(file_path.to_string());
    }
    fn on_skill_file(&self, entry: SkillFileEntry) {
        self.r().skill_files.push(entry);
    }
    fn on_queued_processed(&self, uuid: &str) {
        self.r().queued.push(uuid.to_string());
    }
    fn on_todo_update(&self, todos: Vec<TodoItem>) {
        self.r().todos.push(todos);
    }
    fn on_pr_detected(&self, pr: DetectedPr) {
        self.r().prs.push(pr);
    }
    fn on_cli_message(&self, text: &str) {
        self.r().cli_messages.push(text.to_string());
    }
    fn on_skill_loaded(&self, entry: mainframe_adapter_api::LoadedSkill) {
        self.r().skill_loaded.push(entry);
    }
    fn on_subagent_child(&self, parent_tool_use_id: &str, blocks: Vec<MessageContent>) {
        self.r()
            .subagent
            .push((parent_tool_use_id.to_string(), blocks));
    }
    fn on_trust_required(&self, project_path: &str) {
        self.r().trust.push(project_path.to_string());
    }
    fn on_provider_quota(&self, adapter_id: &str, quota: mainframe_types::adapter::ProviderQuota) {
        self.r()
            .provider_quota
            .push((adapter_id.to_string(), quota));
    }
    fn on_attention_request(&self, message: &str) {
        self.r().attention_requests.push(message.to_string());
    }
    fn on_api_retry(&self, attempt: i64, reason: Option<String>) {
        self.r().api_retries.push((attempt, reason));
    }
}

pub(super) fn session_at(path: &str, tracker: Arc<BackgroundTaskTracker>) -> Arc<ClaudeSession> {
    let s = Arc::new(ClaudeSession::new(
        SessionOptions {
            project_path: path.to_string(),
            chat_id: None,
            mainframe_chat_id: "test-chat-id".to_string(),
            session_file_path: None,
            fork_source: None,
        },
        None,
        tracker,
        Arc::new(ClaudeWorkflowStore::new()),
        mainframe_runtime::ResolvedPath::from_value("/usr/bin:/bin"),
    ));
    s.init_weak();
    s
}
pub(super) fn session() -> Arc<ClaudeSession> {
    session_at("/tmp", Arc::new(BackgroundTaskTracker::new()))
}
pub(super) fn feed(session: &ClaudeSession, sink: &RecordingSink, event: Value) {
    let line = format!("{}\n", serde_json::to_string(&event).unwrap());
    handle_stdout(session, line.as_bytes(), sink);
}
pub(super) fn block_value(blocks: &[MessageContent], i: usize) -> Value {
    serde_json::to_value(&blocks[i]).unwrap()
}

#[path = "../events/tests/events_synthetic_tests.rs"]
mod events_synthetic_tests;

#[path = "init.rs"]
mod init;

#[path = "control.rs"]
mod control;

#[path = "results.rs"]
mod results;

#[path = "notifications.rs"]
mod notifications;

#[path = "stderr.rs"]
mod stderr;

#[path = "skills.rs"]
mod skills;
#[path = "subagents.rs"]
mod subagents;
