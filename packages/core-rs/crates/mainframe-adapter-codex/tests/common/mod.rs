//! Shared test support: a `SessionSink` that records the callbacks the codex
//! event-mapper / approval-handler drive (mirrors the vitest `createSink()` mocks).
#![allow(dead_code)] // each test binary uses a subset of Recorder's surface

use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use mainframe_adapter_api::{AdapterError, ControlRequest, LoadedSkill, SessionSink};
use mainframe_adapter_codex::event_mapper::{CodexSessionState, handle_notification};
use mainframe_adapter_codex::thread_registry::ThreadRegistryDeps;
use mainframe_types::adapter::{
    ContextUsage, DetectedPr, MessageMetadata, ProviderQuota, SessionResult,
};
use mainframe_types::chat::{MessageContent, TodoItem};
use mainframe_types::context::SkillFileEntry;
use serde_json::Value;

#[derive(Default)]
pub struct Recorded {
    pub messages: Vec<Vec<MessageContent>>,
    pub tool_results: Vec<Vec<MessageContent>>,
    pub permissions: Vec<ControlRequest>,
    pub results: Vec<SessionResult>,
    pub todos: Vec<Vec<TodoItem>>,
    pub inits: Vec<String>,
    pub compacts: usize,
    pub compact_starts: usize,
    pub provider_quotas: Vec<(String, ProviderQuota)>,
    /// Every block from every `on_message`/`on_tool_result` call, flattened and
    /// in emission order — `nested_blocks`/`top_level_blocks` read this.
    pub ordered_blocks: Vec<MessageContent>,
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
    pub fn provider_quotas(&self) -> Vec<(String, ProviderQuota)> {
        self.0.lock().unwrap().provider_quotas.clone()
    }
    pub fn compacts(&self) -> usize {
        self.0.lock().unwrap().compacts
    }
    pub fn compact_starts(&self) -> usize {
        self.0.lock().unwrap().compact_starts
    }
    /// Every recorded message/tool-result block whose `parentToolUseId` equals
    /// `card_id`, in emission order.
    pub fn nested_blocks(&self, card_id: &str) -> Vec<Value> {
        self.0
            .lock()
            .unwrap()
            .ordered_blocks
            .iter()
            .map(|b| serde_json::to_value(b).expect("block serializes"))
            .filter(|v| v.get("parentToolUseId").and_then(Value::as_str) == Some(card_id))
            .collect()
    }
    /// Every recorded message/tool-result block with no `parentToolUseId`.
    pub fn top_level_blocks(&self) -> Vec<Value> {
        self.0
            .lock()
            .unwrap()
            .ordered_blocks
            .iter()
            .map(|b| serde_json::to_value(b).expect("block serializes"))
            .filter(|v| v.get("parentToolUseId").is_none())
            .collect()
    }
}

struct RecordingSink(Arc<Mutex<Recorded>>);

impl SessionSink for RecordingSink {
    fn on_init(&self, session_id: &str) {
        self.0.lock().unwrap().inits.push(session_id.to_string());
    }
    fn on_message(&self, content: Vec<MessageContent>, _metadata: Option<MessageMetadata>) {
        let mut recorded = self.0.lock().unwrap();
        recorded.ordered_blocks.extend(content.iter().cloned());
        recorded.messages.push(content);
    }
    fn on_tool_result(&self, content: Vec<MessageContent>) {
        let mut recorded = self.0.lock().unwrap();
        recorded.ordered_blocks.extend(content.iter().cloned());
        recorded.tool_results.push(content);
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
    fn on_compact_start(&self) {
        self.0.lock().unwrap().compact_starts += 1;
    }
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
    fn on_provider_quota(&self, adapter_id: &str, quota: ProviderQuota) {
        self.0
            .lock()
            .unwrap()
            .provider_quotas
            .push((adapter_id.to_string(), quota));
    }
}

/// Absolute path to a fixture under `tests/fixtures/`.
pub fn capture_path(name: &str) -> String {
    format!(
        concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/{}"),
        name
    )
}

/// Replay a captured JSONL notification stream through `handle_notification`,
/// one line per notification, in file order.
pub fn replay_capture(path: &str, rec: &Recorder, state: &mut CodexSessionState) {
    let raw = fs::read_to_string(path).expect("read capture");
    let sink = rec.sink();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let value: Value = serde_json::from_str(line).expect("capture line is valid JSON");
        let method = value
            .get("method")
            .and_then(Value::as_str)
            .expect("capture line has a method")
            .to_string();
        let params = value.get("params").cloned().unwrap_or(Value::Null);
        handle_notification(&method, &params, &sink, state);
    }
}

/// A `threads` row for `temp_registry`: `(id, agent_nickname, agent_role,
/// rollout_path)`.
pub type RegistryRow<'a> = (&'a str, Option<&'a str>, Option<&'a str>, Option<&'a str>);

/// Seed a throwaway `threads` table shaped like Codex's `state_5.sqlite` and
/// return `ThreadRegistryDeps` pointing at it.
pub fn temp_registry(rows: &[RegistryRow<'_>]) -> (tempfile::TempDir, ThreadRegistryDeps) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path: PathBuf = dir.path().join("state_5.sqlite");
    let db = rusqlite::Connection::open(&path).expect("open sqlite");
    db.execute(
        "CREATE TABLE threads (id TEXT PRIMARY KEY, agent_nickname TEXT, agent_role TEXT, rollout_path TEXT)",
        [],
    )
    .expect("create threads table");
    for (id, nickname, role, rollout_path) in rows {
        db.execute(
            "INSERT INTO threads (id, agent_nickname, agent_role, rollout_path) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![id, nickname, role, rollout_path],
        )
        .expect("insert row");
    }
    let deps = ThreadRegistryDeps {
        db_path: Some(path),
    };
    (dir, deps)
}
