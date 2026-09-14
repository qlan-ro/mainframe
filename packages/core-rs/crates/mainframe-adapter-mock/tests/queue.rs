#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::{Arc, Mutex};
use std::time::Duration;

use mainframe_adapter_api::{AdapterError, AdapterSession, LoadedSkill, SessionSink};
use mainframe_adapter_mock::{ReplaySession, parse_fixture};
use mainframe_types::adapter::{
    ContextUsage, ControlRequest, DetectedPr, MessageMetadata, SessionOptions, SessionResult,
};
use mainframe_types::chat::{MessageContent, TodoItem};
use mainframe_types::context::SkillFileEntry;

#[derive(Default)]
struct RecordingSink {
    calls: Mutex<Vec<String>>,
}

impl RecordingSink {
    fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    fn push(&self, call: impl Into<String>) {
        self.calls
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(call.into());
    }
}

impl SessionSink for RecordingSink {
    fn on_init(&self, session_id: &str) {
        self.push(format!("init:{session_id}"));
    }
    fn on_message(&self, _content: Vec<MessageContent>, _metadata: Option<MessageMetadata>) {
        self.push("message");
    }
    fn on_tool_result(&self, _content: Vec<MessageContent>, _vendor_id: Option<String>) {}
    fn on_permission(&self, _request: ControlRequest) {}
    fn on_result(&self, _data: SessionResult) {
        self.push("result");
    }
    fn on_exit(&self, code: Option<i32>) {
        self.push(format!("exit:{code:?}"));
    }
    fn on_error(&self, error: AdapterError) {
        self.push(format!("error:{error}"));
    }
    fn on_compact(&self, _vendor_id: Option<&str>) {}
    fn on_compact_start(&self) {}
    fn on_context_usage(&self, _usage: ContextUsage) {}
    fn on_plan_file(&self, _file_path: &str) {}
    fn on_skill_file(&self, _entry: SkillFileEntry) {}
    fn on_queued_processed(&self, uuid: &str) {
        self.push(format!("queued:{uuid}"));
    }
    fn on_todo_update(&self, _todos: Vec<TodoItem>) {}
    fn on_pr_detected(&self, _pr: DetectedPr) {}
    fn on_cli_message(&self, _text: &str) {}
    fn on_skill_loaded(&self, _entry: LoadedSkill) {}
    fn on_subagent_child(&self, _parent_tool_use_id: &str, _blocks: Vec<MessageContent>) {}
}

/// Two recorded turns: the first parks 100ms on its `onResult`, which is the
/// window a second prompt has to arrive mid-turn.
fn two_turn_fixture() -> Vec<mainframe_adapter_mock::RecordedEvent> {
    let lines = [
        serde_json::json!({ "dir": "out", "method": "onInit", "args": ["recorded-session"], "delayMs": 0 }),
        serde_json::json!({ "dir": "in", "method": "sendMessage", "args": [], "delayMs": 0 }),
        serde_json::json!({ "dir": "out", "method": "onMessage", "args": [[{ "type": "text", "text": "first" }], null], "delayMs": 0 }),
        serde_json::json!({ "dir": "out", "method": "onResult", "args": [{ "subtype": "success" }], "delayMs": 100 }),
        serde_json::json!({ "dir": "in", "method": "sendMessage", "args": [], "delayMs": 100 }),
        serde_json::json!({ "dir": "out", "method": "onMessage", "args": [[{ "type": "text", "text": "second" }], null], "delayMs": 100 }),
        serde_json::json!({ "dir": "out", "method": "onResult", "args": [{ "subtype": "success" }], "delayMs": 100 }),
    ]
    .map(|line| line.to_string())
    .join("\n");
    parse_fixture(&lines).unwrap()
}

async fn spawned_session(sink: Arc<RecordingSink>) -> ReplaySession {
    let session = ReplaySession::new(
        SessionOptions {
            project_path: "/tmp/project".to_string(),
            chat_id: None,
            mainframe_chat_id: "chat-1".to_string(),
        },
        two_turn_fixture(),
    );
    session.spawn(None, Some(sink)).await.unwrap();
    session
}

#[tokio::test]
async fn a_prompt_sent_mid_turn_replays_only_after_the_running_turns_result() {
    let sink = Arc::new(RecordingSink::default());
    let session = spawned_session(sink.clone()).await;
    assert!(session.supports_replay_ack());

    session
        .send_message("first".to_string(), Vec::new(), None)
        .await
        .unwrap();
    session
        .send_message("second".to_string(), Vec::new(), Some("u2".to_string()))
        .await
        .unwrap();

    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(
        sink.calls(),
        [
            "init:recorded-session",
            "message",
            "result",
            "queued:u2",
            "message",
            "result"
        ]
    );
}

#[tokio::test]
async fn cancelling_a_queued_prompt_drops_it_before_the_result() {
    let sink = Arc::new(RecordingSink::default());
    let session = spawned_session(sink.clone()).await;

    session
        .send_message("first".to_string(), Vec::new(), None)
        .await
        .unwrap();
    session
        .send_message("second".to_string(), Vec::new(), Some("u2".to_string()))
        .await
        .unwrap();

    assert!(
        session
            .cancel_queued_message("u2".to_string())
            .await
            .unwrap()
    );
    assert!(
        !session
            .cancel_queued_message("u2".to_string())
            .await
            .unwrap()
    );

    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(sink.calls(), ["init:recorded-session", "message", "result"]);
}

#[tokio::test]
async fn a_prompt_sent_on_an_idle_session_replays_at_once() {
    let sink = Arc::new(RecordingSink::default());
    let session = spawned_session(sink.clone()).await;

    session
        .send_message("first".to_string(), Vec::new(), None)
        .await
        .unwrap();

    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(sink.calls(), ["init:recorded-session", "message", "result"]);
}

/// A uuid means the daemon already filed a `queuedRef` for this prompt. Replaying
/// it at once leaves no later `onResult` to retire that ref, so the ack has to
/// come now — before the turn it belongs to.
#[tokio::test]
async fn a_uuid_carrying_prompt_replayed_at_once_is_acked() {
    let sink = Arc::new(RecordingSink::default());
    let session = spawned_session(sink.clone()).await;

    session
        .send_message("first".to_string(), Vec::new(), Some("u1".to_string()))
        .await
        .unwrap();

    tokio::time::sleep(Duration::from_millis(300)).await;
    let calls = sink.calls();
    let ack = calls.iter().position(|call| call == "queued:u1");
    let message = calls.iter().position(|call| call == "message");
    assert!(ack < message, "{calls:?}");
    assert!(ack.is_some(), "{calls:?}");
}

/// The daemon's exit sweep is what drops stale queued refs and puts the chat back
/// to idle; Claude gets it from the dying child, a replay session has to say so.
#[tokio::test]
async fn killing_the_session_reports_the_exit_the_daemon_sweeps_on() {
    let sink = Arc::new(RecordingSink::default());
    let session = spawned_session(sink.clone()).await;

    session.kill().await.unwrap();

    assert!(sink.calls().contains(&"exit:None".to_string()));
}
