//! Moved out of `event_mapper.rs` (task 1, todo #247) to keep that file under
//! the 300-line ceiling. `ParentIdSink`, unchanged.

use std::sync::Arc;

use mainframe_adapter_api::SessionSink;
use mainframe_types::adapter::{MessageMetadata, SessionResult};
use mainframe_types::chat::{MessageContent, TodoItem};

use crate::history::with_parent;

/// Wraps a sink to tag every emitted block with `parentToolUseId` (mirrors the TS
/// `wrapSinkWithParentId`). Only `on_message`/`on_tool_result` are transformed;
/// every other callback delegates unchanged.
pub(crate) struct ParentIdSink {
    inner: Arc<dyn SessionSink>,
    parent: String,
}

impl ParentIdSink {
    pub(crate) fn new(inner: Arc<dyn SessionSink>, parent: String) -> Self {
        Self { inner, parent }
    }
}

impl SessionSink for ParentIdSink {
    fn on_init(&self, session_id: &str) {
        self.inner.on_init(session_id);
    }
    fn on_message(&self, content: Vec<MessageContent>, metadata: Option<MessageMetadata>) {
        self.inner.on_message(
            content
                .into_iter()
                .map(|b| with_parent(b, &self.parent))
                .collect(),
            metadata,
        );
    }
    fn on_tool_result(&self, content: Vec<MessageContent>, vendor_id: Option<String>) {
        self.inner.on_tool_result(
            content
                .into_iter()
                .map(|b| with_parent(b, &self.parent))
                .collect(),
            vendor_id,
        );
    }
    fn on_permission(&self, request: mainframe_adapter_api::ControlRequest) {
        self.inner.on_permission(request);
    }
    fn on_permission_cancelled(&self, request_id: &str) {
        self.inner.on_permission_cancelled(request_id);
    }
    fn on_result(&self, data: SessionResult) {
        self.inner.on_result(data);
    }
    fn on_exit(&self, code: Option<i32>) {
        self.inner.on_exit(code);
    }
    fn on_error(&self, error: mainframe_adapter_api::AdapterError) {
        self.inner.on_error(error);
    }
    fn on_compact(&self) {
        self.inner.on_compact();
    }
    fn on_compact_start(&self) {
        self.inner.on_compact_start();
    }
    fn on_context_usage(&self, usage: mainframe_types::adapter::ContextUsage) {
        self.inner.on_context_usage(usage);
    }
    fn on_plan_file(&self, file_path: &str) {
        self.inner.on_plan_file(file_path);
    }
    fn on_skill_file(&self, entry: mainframe_types::context::SkillFileEntry) {
        self.inner.on_skill_file(entry);
    }
    fn on_queued_processed(&self, uuid: &str) {
        self.inner.on_queued_processed(uuid);
    }
    fn on_todo_update(&self, todos: Vec<TodoItem>) {
        self.inner.on_todo_update(todos);
    }
    fn on_pr_detected(&self, pr: mainframe_types::adapter::DetectedPr) {
        self.inner.on_pr_detected(pr);
    }
    fn on_cli_message(&self, text: &str) {
        self.inner.on_cli_message(text);
    }
    fn on_skill_loaded(&self, entry: mainframe_adapter_api::LoadedSkill) {
        self.inner.on_skill_loaded(entry);
    }
    fn on_subagent_child(&self, parent_tool_use_id: &str, blocks: Vec<MessageContent>) {
        self.inner.on_subagent_child(parent_tool_use_id, blocks);
    }
    fn on_trust_required(&self, project_path: &str) {
        self.inner.on_trust_required(project_path);
    }
}

#[cfg(test)]
mod tests;
