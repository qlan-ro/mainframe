#![allow(clippy::unwrap_used, clippy::expect_used)]

use mainframe_types::sync::LockExt;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use mainframe_adapter_api::{AdapterError, AdapterSession, SessionSink};
use mainframe_adapter_mock::{ReplaySession, parse_fixture, sanitize_key};
use mainframe_types::adapter::{
    ControlRequest, ControlResponse, MessageMetadata, SessionOptions, SessionResult,
};
use mainframe_types::chat::{MessageContent, MessageContentNode};

#[derive(Default)]
struct RecordingSink {
    calls: Mutex<Vec<String>>,
    changed: tokio::sync::Notify,
    plan_gate: Option<Arc<std::sync::Barrier>>,
}

impl RecordingSink {
    async fn wait_for_calls(&self, count: usize) {
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let changed = self.changed.notified();
                tokio::pin!(changed);
                changed.as_mut().enable();
                if self.calls().len() >= count {
                    return;
                }
                changed.await;
            }
        })
        .await
        .expect("recorded callbacks");
    }

    fn push(&self, call: impl Into<String>) {
        self.calls.lock_recover().push(call.into());
        self.changed.notify_waiters();
    }

    fn calls(&self) -> Vec<String> {
        self.calls.lock_recover().clone()
    }
}

impl SessionSink for RecordingSink {
    mainframe_adapter_api::forward_session_sink!(
        on_context_usage,
        on_skill_file,
        on_queued_processed,
        on_todo_update,
        on_pr_detected,
        on_cli_message,
        on_skill_loaded,
        on_subagent_child
    );

    fn on_init(&self, session_id: &str) {
        self.push(format!("init:{session_id}"));
    }

    fn on_message(&self, _content: Vec<MessageContent>, _metadata: Option<MessageMetadata>) {
        self.push("message");
    }

    fn on_tool_result(&self, _content: Vec<MessageContent>, _vendor_id: Option<String>) {
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

    fn on_compact(&self, _vendor_id: Option<&str>) {
        self.push("compact");
    }

    fn on_compact_start(&self) {
        self.push("compact-start");
    }

    fn on_plan_file(&self, file_path: &str) {
        if file_path == "0"
            && let Some(gate) = &self.plan_gate
        {
            gate.wait();
            gate.wait();
        }
        self.push(format!("plan:{file_path}"));
    }
}

fn options(project_path: String) -> SessionOptions {
    SessionOptions {
        project_path,
        chat_id: None,
        mainframe_chat_id: "chat-1".to_string(),
        session_file_path: None,
        fork_source: None,
    }
}

#[tokio::test(start_paused = true)]
async fn replays_sink_calls_and_ignores_a_late_permission_response() {
    let events = parse_fixture(include_str!("fixtures/replay.ndjson")).unwrap();
    let session = ReplaySession::new(options("/tmp/mf-e2e-current".to_string()), events);
    let sink = Arc::new(RecordingSink::default());

    session.spawn(None, Some(sink.clone())).await.unwrap();
    session
        .send_message("hello".to_string(), Vec::new(), Some("u1".to_string()))
        .await
        .unwrap();
    sink.wait_for_calls(4).await;

    assert_eq!(
        sink.calls(),
        ["init:recorded-session", "message", "message", "tool-result"]
    );

    // A `respondToPermission` past the end of the fixture is silently ignored
    // (the real CLI drops a control response for a request it already
    // resolved) rather than reported as a desync — see
    // `session::tests::a_permission_answer_past_the_end_of_the_fixture_is_ignored`
    // for the same contract at the `take_interaction` level. The sink's call
    // list is therefore unchanged, not appended with a "fixture exhausted" error.
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
            scope: None,
        })
        .await
        .unwrap();

    assert_eq!(
        sink.calls(),
        ["init:recorded-session", "message", "message", "tool-result"]
    );
}

#[tokio::test]
async fn load_history_remaps_recorded_project_paths() {
    let events = parse_fixture(include_str!("fixtures/replay.ndjson")).unwrap();
    let project_path = "/tmp/mf-e2e-current".to_string();
    let session = ReplaySession::new(options(project_path.clone()), events);

    let history = session.load_history().await.unwrap();
    let input = history
        .iter()
        .flat_map(|m| m.content.iter())
        .find_map(|c| match c {
            MessageContent::Node(MessageContentNode::ToolUse { input, .. }) => Some(input),
            _ => None,
        })
        .expect("expected a tool-use history block");

    assert_eq!(
        input.get("file_path").and_then(serde_json::Value::as_str),
        Some("/tmp/mf-e2e-current/src/main.ts")
    );
}

#[tokio::test]
async fn load_history_lists_recorded_prompts_as_user_messages() {
    use mainframe_types::chat::ChatMessageType;
    let events = parse_fixture(include_str!("fixtures/replay.ndjson")).unwrap();
    let session = ReplaySession::new(options("/tmp/p".to_string()), events);

    let history = session.load_history().await.unwrap();
    assert_eq!(history[0].r#type, ChatMessageType::User);
    assert_eq!(history[0].id, "mock-history-0");
}

/// An unsent from-message fork replays its parent's recording only up to the
/// cut message (the mock pins the cut id in `last_turn_id`).
#[tokio::test]
async fn an_unsent_forks_history_stops_before_the_cut_message() {
    let events = parse_fixture(include_str!("fixtures/replay.ndjson")).unwrap();
    let fork_options = SessionOptions {
        fork_source: Some(mainframe_types::adapter::ForkSource {
            source_session_id: "recorded-session".to_string(),
            resume_path: None,
            last_turn_id: Some("mock-history-3".to_string()),
        }),
        ..options("/tmp/p".to_string())
    };
    let session = ReplaySession::new(fork_options, events);

    let history = session.load_history().await.unwrap();
    let ids: Vec<&str> = history.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, ["mock-history-0", "mock-history-2"]);
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
    let gate = Arc::new(std::sync::Barrier::new(2));
    let sink = Arc::new(RecordingSink {
        plan_gate: Some(gate.clone()),
        ..Default::default()
    });
    session.spawn(None, Some(sink.clone())).await.unwrap();

    session
        .send_message(String::new(), Vec::new(), None)
        .await
        .unwrap();
    tokio::task::spawn_blocking(move || {
        gate.wait();
        gate.wait();
    })
    .await
    .unwrap();
    sink.wait_for_calls(8).await;

    assert_eq!(
        sink.calls(),
        (0..8)
            .map(|index| format!("plan:{index}"))
            .collect::<Vec<_>>()
    );
}
