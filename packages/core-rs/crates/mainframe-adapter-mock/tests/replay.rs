#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::{Arc, Mutex};
use std::time::Duration;

use mainframe_adapter_api::{AdapterError, AdapterSession, LoadedSkill, SessionSink};
use mainframe_adapter_mock::{ReplaySession, parse_fixture, sanitize_key};
use mainframe_types::adapter::{
    ContextUsage, ControlRequest, ControlResponse, DetectedPr, MessageMetadata, SessionOptions,
    SessionResult,
};
use mainframe_types::chat::{MessageContent, MessageContentNode, TodoItem};
use mainframe_types::context::SkillFileEntry;

#[derive(Default)]
struct RecordingSink {
    calls: Mutex<Vec<String>>,
}

impl RecordingSink {
    fn push(&self, call: impl Into<String>) {
        self.calls
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(call.into());
    }

    fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

impl SessionSink for RecordingSink {
    fn on_init(&self, session_id: &str) {
        self.push(format!("init:{session_id}"));
    }

    fn on_message(&self, _content: Vec<MessageContent>, _metadata: Option<MessageMetadata>) {
        self.push("message");
    }

    fn on_tool_result(&self, _content: Vec<MessageContent>) {
        self.push("tool-result");
    }

    fn on_permission(&self, _request: ControlRequest) {
        self.push("permission");
    }

    fn on_result(&self, _data: SessionResult) {
        self.push("result");
    }

    fn on_exit(&self, code: Option<i32>) {
        self.push(format!("exit:{code:?}"));
    }

    fn on_error(&self, error: AdapterError) {
        self.push(format!("error:{error}"));
    }

    fn on_compact(&self) {
        self.push("compact");
    }

    fn on_compact_start(&self) {
        self.push("compact-start");
    }

    fn on_context_usage(&self, _usage: ContextUsage) {}
    fn on_plan_file(&self, file_path: &str) {
        if file_path == "0" {
            std::thread::sleep(Duration::from_millis(20));
        }
        self.push(format!("plan:{file_path}"));
    }
    fn on_skill_file(&self, _entry: SkillFileEntry) {}
    fn on_queued_processed(&self, _uuid: &str) {}
    fn on_todo_update(&self, _todos: Vec<TodoItem>) {}
    fn on_pr_detected(&self, _pr: DetectedPr) {}
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
async fn replays_sink_calls_and_reports_desync() {
    let events = parse_fixture(include_str!("fixtures/replay.ndjson")).unwrap();
    let session = ReplaySession::new(options("/tmp/mf-e2e-current".to_string()), events);
    let sink = Arc::new(RecordingSink::default());

    session.spawn(None, Some(sink.clone())).await.unwrap();
    session
        .send_message("hello".to_string(), Vec::new(), Some("u1".to_string()))
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(140)).await;

    assert_eq!(
        sink.calls(),
        ["init:recorded-session", "message", "message", "tool-result"]
    );

    session
        .respond_to_permission(ControlResponse {
            request_id: "r1".to_string(),
            tool_use_id: "t1".to_string(),
            tool_name: None,
            behavior: mainframe_types::adapter::ControlBehavior::Deny,
            updated_input: None,
            updated_permissions: None,
            message: None,
            execution_mode: None,
            clear_context: None,
        })
        .await
        .unwrap();

    assert!(sink.calls().last().unwrap().contains("fixture exhausted"));
}

#[tokio::test]
async fn load_history_remaps_recorded_project_paths() {
    let events = parse_fixture(include_str!("fixtures/replay.ndjson")).unwrap();
    let project_path = "/tmp/mf-e2e-current".to_string();
    let session = ReplaySession::new(options(project_path.clone()), events);

    let history = session.load_history().await.unwrap();
    let MessageContent::Node(MessageContentNode::ToolUse { input, .. }) = &history[1].content[0]
    else {
        panic!("expected tool-use history block");
    };

    assert_eq!(
        input.get("file_path").and_then(serde_json::Value::as_str),
        Some("/tmp/mf-e2e-current/src/main.ts")
    );
}

#[test]
fn sanitizes_fixture_keys() {
    assert_eq!(sanitize_key(" chat / branch -- test "), "chat-branch-test");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn preserves_fixture_order_when_delays_hit_the_cap() {
    let mut lines = vec![
        serde_json::json!({
            "dir": "in",
            "method": "sendMessage",
            "args": [],
            "delayMs": 0
        })
        .to_string(),
    ];
    for index in 0..8 {
        lines.push(
            serde_json::json!({
                "dir": "out",
                "method": "onPlanFile",
                "args": [index.to_string()],
                "delayMs": 1_000 + index
            })
            .to_string(),
        );
    }
    let session = ReplaySession::new(
        options("/tmp/project".to_string()),
        parse_fixture(&lines.join("\n")).unwrap(),
    );
    let sink = Arc::new(RecordingSink::default());
    session.spawn(None, Some(sink.clone())).await.unwrap();

    session
        .send_message(String::new(), Vec::new(), None)
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(180)).await;

    assert_eq!(
        sink.calls(),
        (0..8)
            .map(|index| format!("plan:{index}"))
            .collect::<Vec<_>>()
    );
}
