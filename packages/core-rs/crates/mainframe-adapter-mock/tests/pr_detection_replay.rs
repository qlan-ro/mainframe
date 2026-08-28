//! "Any adapter inherits detection" spec (todo #339, task 9): drives the mock
//! adapter — a stand-in for "some adapter that isn't Claude" — through
//! `PrDetectionSink` using only the crate's public replay surface (`dispatch`
//! is private, `emit_event` is `pub(crate)`; see `src/dispatch.rs:23,29`).
//! Proves the decorator applies to every adapter, not just Claude's own
//! NDJSON handlers. Red-phase until Group C lands `PrDetectionSink`: expect
//! "cannot find type/function `PrDetectionSink`" until then.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::{Arc, Mutex};
use std::time::Duration;

use mainframe_adapter_api::pr_detection::PrDetectionSink;
use mainframe_adapter_api::{AdapterError, AdapterSession, LoadedSkill, SessionSink};
use mainframe_adapter_mock::{ReplaySession, parse_fixture};
use mainframe_types::adapter::{
    ContextUsage, ControlRequest, DetectedPr, DetectedPrSource, MessageMetadata, SessionOptions,
    SessionResult,
};
use mainframe_types::chat::{MessageContent, TodoItem};
use mainframe_types::context::SkillFileEntry;

#[derive(Default)]
struct RecordingSink {
    prs: Mutex<Vec<DetectedPr>>,
}

impl RecordingSink {
    fn prs(&self) -> Vec<DetectedPr> {
        self.prs.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

impl SessionSink for RecordingSink {
    fn on_init(&self, _session_id: &str) {}
    fn on_message(&self, _content: Vec<MessageContent>, _metadata: Option<MessageMetadata>) {}
    fn on_tool_result(&self, _content: Vec<MessageContent>, _vendor_id: Option<String>) {}
    fn on_permission(&self, _request: ControlRequest) {}
    fn on_result(&self, _data: SessionResult) {}
    fn on_exit(&self, _code: Option<i32>) {}
    fn on_error(&self, _error: AdapterError) {}
    fn on_compact(&self) {}
    fn on_compact_start(&self) {}
    fn on_context_usage(&self, _usage: ContextUsage) {}
    fn on_plan_file(&self, _file_path: &str) {}
    fn on_skill_file(&self, _entry: SkillFileEntry) {}
    fn on_queued_processed(&self, _uuid: &str) {}
    fn on_todo_update(&self, _todos: Vec<TodoItem>) {}
    fn on_pr_detected(&self, pr: DetectedPr) {
        self.prs.lock().unwrap_or_else(|e| e.into_inner()).push(pr);
    }
    fn on_cli_message(&self, _text: &str) {}
    fn on_skill_loaded(&self, _entry: LoadedSkill) {}
    fn on_subagent_child(&self, _parent_tool_use_id: &str, _blocks: Vec<MessageContent>) {}
}

fn options(project_path: String) -> SessionOptions {
    SessionOptions {
        project_path,
        chat_id: None,
        mainframe_chat_id: "chat-1".to_string(),
    }
}

#[tokio::test]
async fn mock_adapter_output_is_detected_through_the_shared_sink_decorator() {
    // The fixture deliberately contains no `onPrDetected` event: the decorator
    // delegates that call straight through, so a recorded one would satisfy
    // the assertion below without any detection actually happening.
    let lines = [
        serde_json::json!({
            "dir": "in",
            "method": "sendMessage",
            "args": [],
            "delayMs": 0
        })
        .to_string(),
        serde_json::json!({
            "dir": "out",
            "method": "onMessage",
            "args": [
                [{
                    "type": "tool_use",
                    "id": "tu1",
                    "name": "Bash",
                    "input": { "command": "gh pr create --title x" }
                }],
                null
            ],
            "delayMs": 0
        })
        .to_string(),
        serde_json::json!({
            "dir": "out",
            "method": "onToolResult",
            "args": [
                [{
                    "type": "tool_result",
                    "toolUseId": "tu1",
                    "content": "Created https://github.com/acme/repo/pull/7",
                    "isError": false
                }]
            ],
            "delayMs": 0
        })
        .to_string(),
    ];

    let session = ReplaySession::new(
        options("/tmp/mf-pr-detection-replay".to_string()),
        parse_fixture(&lines.join("\n")).unwrap(),
    );
    let inner = Arc::new(RecordingSink::default());
    session
        .spawn(None, Some(Arc::new(PrDetectionSink::new(inner.clone()))))
        .await
        .unwrap();

    session
        .send_message(String::new(), Vec::new(), None)
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(140)).await;

    assert_eq!(
        inner.prs(),
        vec![DetectedPr {
            url: "https://github.com/acme/repo/pull/7".to_string(),
            owner: "acme".to_string(),
            repo: "repo".to_string(),
            number: 7,
            source: DetectedPrSource::Created,
        }]
    );
}
