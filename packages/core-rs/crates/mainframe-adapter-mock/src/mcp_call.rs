//! The `mcp_call` fixture step: a real call to the daemon's `mainframe` MCP
//! server with the spawn's credential, the way a CLI makes one mid-turn.
//!
//! ```json
//! {"dir":"out","method":"mcp_call","args":[{"toolUseId":"toolu_1","tool":"delegate_task",
//!   "arguments":{"task":"Review the diff"}}],"delayMs":80}
//! ```
//!
//! The replay emits the `mcp__mainframe__<tool>` tool use, makes the HTTP
//! call, then emits the server's answer as the tool result, so the transcript
//! shows exactly what a live CLI would. Results carry ids minted at run time
//! (task and chat ids), which is why this cannot be a recorded `onToolResult`.

use mainframe_adapter_api::SessionSink;
use mainframe_types::chat::MessageContent;
use mainframe_types::orchestration::{MCP_SERVER_NAME, OrchestrationMcpLaunch};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::fixture::RecordedEvent;

pub const MCP_CALL_METHOD: &str = "mcp_call";

const PROTOCOL_VERSION: &str = "2025-06-18";

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpCall {
    pub tool_use_id: String,
    pub tool: String,
    #[serde(default = "empty_object")]
    pub arguments: Value,
}

fn empty_object() -> Value {
    json!({})
}

/// What the server answered: the tool's text and whether it is an error.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpOutcome {
    pub text: String,
    pub is_error: bool,
}

impl McpOutcome {
    fn failed(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            is_error: true,
        }
    }
}

pub(crate) fn parse_call(event: &RecordedEvent) -> Result<McpCall, String> {
    let arg = event.args.first().cloned().ok_or("missing argument 0")?;
    serde_json::from_value(arg).map_err(|error| error.to_string())
}

/// One `tools/call` against the spawn's endpoint. Never panics: a refused or
/// broken call comes back as an error outcome, as a CLI would show it.
pub async fn call_tool(
    launch: &OrchestrationMcpLaunch,
    tool: &str,
    arguments: Value,
) -> McpOutcome {
    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": { "name": tool, "arguments": arguments },
    });
    let response = reqwest::Client::new()
        .post(&launch.url)
        .bearer_auth(launch.token.expose())
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .header("MCP-Protocol-Version", PROTOCOL_VERSION)
        .body(body.to_string())
        .send()
        .await;
    let response = match response {
        Ok(response) => response,
        Err(error) => return McpOutcome::failed(format!("mcp request failed: {error}")),
    };
    let status = response.status();
    match response.text().await {
        Ok(text) if status.is_success() => parse_response(&text),
        Ok(_) => McpOutcome::failed(format!("mcp request refused: HTTP {}", status.as_u16())),
        Err(error) => McpOutcome::failed(format!("mcp response unreadable: {error}")),
    }
}

/// A JSON-RPC response to `tools/call`: the first text block of `result`, or
/// the protocol error's message.
pub(crate) fn parse_response(text: &str) -> McpOutcome {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return McpOutcome::failed("mcp response is not JSON");
    };
    if let Some(message) = value["error"]["message"].as_str() {
        return McpOutcome::failed(message);
    }
    let result = &value["result"];
    McpOutcome {
        text: result["content"][0]["text"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        is_error: result["isError"].as_bool().unwrap_or(false),
    }
}

/// Replays one `mcp_call` step onto `sink`. Without a credential (a chat
/// spawned with no orchestration server attached) the tool result says so.
pub(crate) async fn replay(
    sink: &dyn SessionSink,
    launch: Option<&OrchestrationMcpLaunch>,
    event: &RecordedEvent,
) {
    let call = match parse_call(event) {
        Ok(call) => call,
        Err(error) => {
            tracing::warn!(%error, "mock-cli dropped an invalid mcp_call step");
            return;
        }
    };
    let tool_name = format!("mcp__{MCP_SERVER_NAME}__{}", call.tool);
    sink.on_message(
        content(json!([{ "type": "tool_use", "id": call.tool_use_id,
            "name": tool_name, "input": call.arguments }])),
        None,
    );
    let outcome = match launch {
        Some(launch) => call_tool(launch, &call.tool, call.arguments.clone()).await,
        None => McpOutcome::failed("mock-cli was spawned without an orchestration credential"),
    };
    sink.on_tool_result(
        content(
            json!([{ "type": "tool_result", "toolUseId": call.tool_use_id,
            "content": outcome.text, "isError": outcome.is_error }]),
        ),
        None,
    );
}

fn content(value: Value) -> Vec<MessageContent> {
    serde_json::from_value(value).unwrap_or_else(|error| {
        tracing::warn!(%error, "mock-cli built an invalid mcp_call block");
        Vec::new()
    })
}

#[cfg(test)]
#[path = "mcp_call_tests.rs"]
mod tests;
