//! Shared test support: a `SessionSink` that records the callbacks the codex
//! event-mapper / approval-handler drive (mirrors the vitest `createSink()` mocks).
#![allow(dead_code)] // each test binary uses a subset of Recorder's surface

use std::sync::{Arc, Mutex};

use mainframe_adapter_api::{AdapterError, ControlRequest, LoadedSkill, SessionSink};
use mainframe_types::adapter::{ContextUsage, DetectedPr, MessageMetadata, SessionResult};
use mainframe_types::chat::{MessageContent, TodoItem};
use mainframe_types::context::SkillFileEntry;

#[derive(Default)]
pub struct Recorded {
    pub messages: Vec<Vec<MessageContent>>,
    pub tool_results: Vec<Vec<MessageContent>>,
    pub permissions: Vec<ControlRequest>,
    pub results: Vec<SessionResult>,
    pub todos: Vec<Vec<TodoItem>>,
    pub inits: Vec<String>,
    pub compacts: usize,
}

#[derive(Clone, Default)]
pub struct Recorder(pub Arc<Mutex<Recorded>>);

impl Recorder {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn sink(&self) -> Arc<dyn SessionSink> {
        Arc::new(RecordingSink(self.0.clone()))
    }
    pub fn messages(&self) -> Vec<Vec<MessageContent>> {
        self.0.lock().unwrap().messages.clone()
    }
    pub fn tool_results(&self) -> Vec<Vec<MessageContent>> {
        self.0.lock().unwrap().tool_results.clone()
    }
    pub fn permissions(&self) -> Vec<ControlRequest> {
        self.0.lock().unwrap().permissions.clone()
    }
    pub fn results(&self) -> Vec<SessionResult> {
        self.0.lock().unwrap().results.clone()
    }
    pub fn clear_messages(&self) {
        self.0.lock().unwrap().messages.clear();
    }
}

struct RecordingSink(Arc<Mutex<Recorded>>);

impl SessionSink for RecordingSink {
    fn on_init(&self, session_id: &str) {
        self.0.lock().unwrap().inits.push(session_id.to_string());
    }
    fn on_message(&self, content: Vec<MessageContent>, _metadata: Option<MessageMetadata>) {
        self.0.lock().unwrap().messages.push(content);
    }
    fn on_tool_result(&self, content: Vec<MessageContent>) {
        self.0.lock().unwrap().tool_results.push(content);
    }
    fn on_permission(&self, request: ControlRequest) {
        self.0.lock().unwrap().permissions.push(request);
    }
    fn on_result(&self, data: SessionResult) {
        self.0.lock().unwrap().results.push(data);
    }
    fn on_exit(&self, _code: Option<i32>) {}
    fn on_error(&self, _error: AdapterError) {}
    fn on_compact(&self) {
        self.0.lock().unwrap().compacts += 1;
    }
    fn on_compact_start(&self) {}
    fn on_context_usage(&self, _usage: ContextUsage) {}
    fn on_plan_file(&self, _file_path: &str) {}
    fn on_skill_file(&self, _entry: SkillFileEntry) {}
    fn on_queued_processed(&self, _uuid: &str) {}
    fn on_todo_update(&self, todos: Vec<TodoItem>) {
        self.0.lock().unwrap().todos.push(todos);
    }
    fn on_pr_detected(&self, _pr: DetectedPr) {}
    fn on_cli_message(&self, _text: &str) {}
    fn on_skill_loaded(&self, _entry: LoadedSkill) {}
    fn on_subagent_child(&self, _parent_tool_use_id: &str, _blocks: Vec<MessageContent>) {}
}
