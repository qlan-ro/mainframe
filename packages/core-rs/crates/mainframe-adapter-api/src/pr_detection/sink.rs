//! The `SessionSink` decorator that runs live PR scanning at the one seam
//! every adapter crosses (todo #339, task 11). Wrapping the inner sink here —
//! rather than inside an adapter's own event handlers — is what makes
//! detection adapter-neutral: `build_sink` wraps once and every adapter
//! inherits it.

use std::sync::{Arc, Mutex};

use mainframe_types::adapter::{
    ContextUsage, ControlRequest, DetectedPr, MessageMetadata, ProviderQuota, SessionResult,
};
use mainframe_types::chat::{MessageContent, MessageContentNode, TodoItem};
use mainframe_types::context::SkillFileEntry;

use super::live::LivePrScanner;
use crate::AdapterError;
use crate::adapter::{LoadedSkill, SessionSink};

/// Wraps an inner `SessionSink`, scanning `on_message` / `on_tool_result`
/// traffic for PR-create/mutation commands and their results, then forwarding
/// any hit to the inner sink's `on_pr_detected`. Every other callback
/// delegates straight through, unmodified.
pub struct PrDetectionSink {
    inner: Arc<dyn SessionSink>,
    state: Mutex<LivePrScanner>,
}

impl PrDetectionSink {
    pub fn new(inner: Arc<dyn SessionSink>) -> Self {
        Self {
            inner,
            state: Mutex::new(LivePrScanner::new()),
        }
    }

    fn observe_tool_uses(&self, content: &[MessageContent]) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        for block in content {
            if let MessageContent::Node(MessageContentNode::ToolUse {
                id, name, input, ..
            }) = block
            {
                state.observe_tool_use(id, name, input);
            }
        }
    }

    fn observe_tool_results(&self, content: &[MessageContent]) -> Vec<DetectedPr> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let mut hits = Vec::new();
        for block in content {
            if let MessageContent::Node(MessageContentNode::ToolResult {
                tool_use_id,
                content,
                is_error,
                ..
            }) = block
            {
                hits.extend(state.observe_tool_result(tool_use_id, content, *is_error));
            }
        }
        hits
    }
}

impl SessionSink for PrDetectionSink {
    fn on_init(&self, session_id: &str) {
        self.inner.on_init(session_id);
    }

    fn on_message(&self, content: Vec<MessageContent>, metadata: Option<MessageMetadata>) {
        self.observe_tool_uses(&content);
        self.inner.on_message(content, metadata);
    }

    fn on_tool_result(&self, content: Vec<MessageContent>, vendor_id: Option<String>) {
        let hits = self.observe_tool_results(&content);
        self.inner.on_tool_result(content, vendor_id);
        for pr in hits {
            self.inner.on_pr_detected(pr);
        }
    }

    fn on_permission(&self, request: ControlRequest) {
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

    fn on_error(&self, error: AdapterError) {
        self.inner.on_error(error);
    }

    fn on_compact(&self) {
        self.inner.on_compact();
    }

    fn on_compact_start(&self) {
        self.inner.on_compact_start();
    }

    fn on_context_usage(&self, usage: ContextUsage) {
        self.inner.on_context_usage(usage);
    }

    fn on_plan_file(&self, file_path: &str) {
        self.inner.on_plan_file(file_path);
    }

    fn on_skill_file(&self, entry: SkillFileEntry) {
        self.inner.on_skill_file(entry);
    }

    fn on_queued_processed(&self, uuid: &str) {
        self.inner.on_queued_processed(uuid);
    }

    fn on_todo_update(&self, todos: Vec<TodoItem>) {
        self.inner.on_todo_update(todos);
    }

    fn on_pr_detected(&self, pr: DetectedPr) {
        self.inner.on_pr_detected(pr);
    }

    fn on_cli_message(&self, text: &str) {
        self.inner.on_cli_message(text);
    }

    fn on_skill_loaded(&self, entry: LoadedSkill) {
        self.inner.on_skill_loaded(entry);
    }

    fn on_subagent_child(&self, parent_tool_use_id: &str, blocks: Vec<MessageContent>) {
        self.inner.on_subagent_child(parent_tool_use_id, blocks);
    }

    fn on_trust_required(&self, project_path: &str) {
        self.inner.on_trust_required(project_path);
    }

    fn on_provider_quota(&self, adapter_id: &str, quota: ProviderQuota) {
        self.inner.on_provider_quota(adapter_id, quota);
    }

    fn on_attention_request(&self, message: &str) {
        self.inner.on_attention_request(message);
    }
}
