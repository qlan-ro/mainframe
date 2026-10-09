use std::sync::Mutex;

use mainframe_adapter_api::{AdapterError, LoadedSkill};
use mainframe_types::adapter::{
    ContextUsage, ControlRequest, DetectedPr, MessageMetadata, SessionResult,
};
use mainframe_types::chat::{MessageContentNode, TodoItem};
use mainframe_types::context::SkillFileEntry;
use mainframe_types::orchestration::SecretToken;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::*;
use crate::fixture::EventDirection;

#[derive(Default)]
struct Captured {
    messages: Mutex<Vec<Vec<MessageContent>>>,
    results: Mutex<Vec<Vec<MessageContent>>>,
}

impl SessionSink for Captured {
    fn on_init(&self, _session_id: &str) {}
    fn on_message(&self, content: Vec<MessageContent>, _metadata: Option<MessageMetadata>) {
        self.messages.lock().unwrap().push(content);
    }
    fn on_tool_result(&self, content: Vec<MessageContent>, _vendor_id: Option<String>) {
        self.results.lock().unwrap().push(content);
    }
    fn on_permission(&self, _request: ControlRequest) {}
    fn on_result(&self, _data: SessionResult) {}
    fn on_exit(&self, _code: Option<i32>) {}
    fn on_error(&self, _error: AdapterError) {}
    fn on_compact(&self, _vendor_id: Option<&str>) {}
    fn on_compact_start(&self) {}
    fn on_context_usage(&self, _usage: ContextUsage) {}
    fn on_plan_file(&self, _file_path: &str) {}
    fn on_skill_file(&self, _entry: SkillFileEntry) {}
    fn on_queued_processed(&self, _uuid: &str) {}
    fn on_todo_update(&self, _todos: Vec<TodoItem>) {}
    fn on_pr_detected(&self, _pr: DetectedPr) {}
    fn on_cli_message(&self, _text: &str) {}
    fn on_skill_loaded(&self, _entry: LoadedSkill) {}
    fn on_subagent_child(&self, _parent_tool_use_id: &str, _blocks: Vec<MessageContent>) {}
}

fn step(arg: Value) -> RecordedEvent {
    RecordedEvent {
        dir: EventDirection::Out,
        method: MCP_CALL_METHOD.into(),
        args: vec![arg],
        delay_ms: 0,
        files: Vec::new(),
        deleted: Vec::new(),
    }
}

/// A one-shot HTTP server answering `reply`; resolves to the raw request.
async fn serve_once(reply: Value) -> (String, tokio::task::JoinHandle<String>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/mcp", listener.local_addr().unwrap());
    let handle = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut raw = Vec::new();
        let mut buf = [0u8; 4096];
        loop {
            let n = socket.read(&mut buf).await.unwrap();
            raw.extend_from_slice(&buf[..n]);
            let text = String::from_utf8_lossy(&raw).to_string();
            if let Some((head, body)) = text.split_once("\r\n\r\n") {
                let length = head
                    .lines()
                    .find_map(|l| {
                        l.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .map(|v| v.trim().parse::<usize>().unwrap())
                    })
                    .unwrap_or(0);
                if body.len() >= length {
                    break;
                }
            }
            if n == 0 {
                break;
            }
        }
        let body = reply.to_string();
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        socket.write_all(response.as_bytes()).await.unwrap();
        String::from_utf8_lossy(&raw).to_string()
    });
    (url, handle)
}

fn launch(url: String) -> OrchestrationMcpLaunch {
    OrchestrationMcpLaunch {
        url,
        token: SecretToken::new("secret".into()),
    }
}

#[test]
fn parse_call_reads_the_step_and_rejects_unknown_fields() {
    let call = parse_call(&step(json!({ "toolUseId": "t1", "tool": "capabilities" }))).unwrap();
    assert_eq!(call.tool, "capabilities");
    assert_eq!(call.arguments, json!({}));
    assert!(parse_call(&step(json!({ "toolUseId": "t1", "tool": "x", "extra": 1 }))).is_err());
}

/// The E2E delegate recording (`packages/e2e/.../mcp-delegate.0.ndjson`)
/// parses, and its `mcp_call` step is a valid `delegate_task` call.
#[test]
fn the_e2e_delegate_recording_carries_a_valid_mcp_call_step() {
    let text = include_str!("../../../../e2e/fixtures/recordings/mcp-delegate.0.ndjson");
    let events = crate::parse_fixture(text).unwrap();
    let steps: Vec<_> = events
        .iter()
        .filter(|e| e.method == MCP_CALL_METHOD)
        .collect();
    assert_eq!(steps.len(), 1);
    let call = parse_call(steps[0]).unwrap();
    assert_eq!(call.tool, "delegate_task");
    assert_eq!(call.arguments["role"], "review");
    let child = include_str!("../../../../e2e/fixtures/recordings/mcp-delegate.1.ndjson");
    assert!(crate::parse_fixture(child).is_ok());
}

#[test]
fn parse_response_reads_results_tool_errors_and_protocol_errors() {
    let ok = json!({ "jsonrpc": "2.0", "id": 1,
        "result": { "content": [{ "type": "text", "text": "{\"taskId\":\"task_c\"}" }], "isError": false } });
    assert_eq!(
        parse_response(&ok.to_string()),
        McpOutcome {
            text: "{\"taskId\":\"task_c\"}".into(),
            is_error: false
        }
    );
    let tool_error =
        json!({ "result": { "content": [{ "type": "text", "text": "no" }], "isError": true } });
    assert!(parse_response(&tool_error.to_string()).is_error);
    let rpc_error = json!({ "error": { "code": -32602, "message": "Unknown tool: x" } });
    assert_eq!(
        parse_response(&rpc_error.to_string()).text,
        "Unknown tool: x"
    );
    assert!(parse_response("<html>").is_error);
}

#[tokio::test]
async fn call_tool_posts_json_rpc_with_the_bearer_token() {
    let reply = json!({ "jsonrpc": "2.0", "id": 1,
        "result": { "content": [{ "type": "text", "text": "done" }], "isError": false } });
    let (url, server) = serve_once(reply).await;
    let outcome = call_tool(&launch(url), "delegate_task", json!({ "task": "t" })).await;
    assert_eq!(outcome.text, "done");
    let request = server.await.unwrap();
    assert!(request.starts_with("POST /mcp HTTP/1.1"));
    assert!(
        request.contains("authorization: Bearer secret")
            || request.contains("Authorization: Bearer secret")
    );
    assert!(request.contains("\"method\":\"tools/call\""));
    assert!(request.contains("\"name\":\"delegate_task\""));
}

#[tokio::test]
async fn replay_emits_the_tool_use_then_the_server_answer() {
    let reply =
        json!({ "result": { "content": [{ "type": "text", "text": "ok" }], "isError": false } });
    let (url, _server) = serve_once(reply).await;
    let sink = Captured::default();
    let event = step(json!({ "toolUseId": "tu", "tool": "capabilities" }));

    replay(&sink, Some(&launch(url)), &event).await;

    let messages = sink.messages.lock().unwrap().clone();
    assert!(matches!(
        &messages[0][0],
        MessageContent::Node(MessageContentNode::ToolUse { name, id, .. })
            if name == "mcp__mainframe__capabilities" && id == "tu"
    ));
    let results = sink.results.lock().unwrap().clone();
    assert!(matches!(
        &results[0][0],
        MessageContent::Node(MessageContentNode::ToolResult { content, is_error, tool_use_id, .. })
            if content == "ok" && !is_error && tool_use_id == "tu"
    ));
}

#[tokio::test]
async fn replay_without_a_credential_reports_an_error_result() {
    let sink = Captured::default();
    replay(
        &sink,
        None,
        &step(json!({ "toolUseId": "tu", "tool": "capabilities" })),
    )
    .await;
    let results = sink.results.lock().unwrap().clone();
    assert!(matches!(
        &results[0][0],
        MessageContent::Node(MessageContentNode::ToolResult { is_error: true, .. })
    ));
}
