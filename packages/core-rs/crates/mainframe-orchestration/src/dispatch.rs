//! Method dispatch for one authenticated JSON-RPC message.

use std::sync::Arc;
use std::time::Instant;

use serde_json::{Value, json};
use tracing::Instrument as _;

use mainframe_types::acp::jsonrpc::error_codes;

use crate::calls::CallCtx;
use crate::credentials::Caller;
use crate::errors::{ToolError, tool_failure, tool_success};
use crate::protocol::{Incoming, RpcReply, classify, initialize_result, rpc_error, rpc_result};
use crate::service::OrchestrationService;
use crate::tools::{self, Tool};

impl OrchestrationService {
    /// Handles one POST body from an authenticated caller.
    pub async fn handle(self: &Arc<Self>, caller: &Caller, body: &[u8]) -> RpcReply {
        match classify(body) {
            Err(reply) => reply,
            Ok(Incoming::Response) => RpcReply::Accepted,
            Ok(Incoming::Notification { method, params }) => {
                on_notification(caller, &method, &params);
                RpcReply::Accepted
            }
            Ok(Incoming::Request { id, method, params }) => {
                RpcReply::Response(self.on_request(caller, id, &method, params).await)
            }
        }
    }

    async fn on_request(
        self: &Arc<Self>,
        caller: &Caller,
        id: Value,
        method: &str,
        params: Value,
    ) -> Value {
        match method {
            "initialize" => rpc_result(id, initialize_result(&params, self.version())),
            "ping" => rpc_result(id, json!({})),
            "tools/list" => rpc_result(id, json!({ "tools": tools::list() })),
            "tools/call" => self.on_tools_call(caller, id, params).await,
            _ => rpc_error(id, error_codes::METHOD_NOT_FOUND, "Method not found"),
        }
    }

    /// Runs the call on its own task. The HTTP server drops the request future
    /// when the client disconnects, and a tool dropped halfway would leave a
    /// launched child without its task row, or a taken outbox batch unsent.
    async fn on_tools_call(self: &Arc<Self>, caller: &Caller, id: Value, params: Value) -> Value {
        let Some(name) = params.get("name").and_then(Value::as_str) else {
            return rpc_error(
                id,
                error_codes::INVALID_PARAMS,
                "tools/call needs a tool name",
            );
        };
        let Some(tool) = Tool::from_name(name) else {
            return rpc_error(
                id,
                error_codes::INVALID_PARAMS,
                &format!("Unknown tool: {name}"),
            );
        };
        let args = params.get("arguments").cloned().unwrap_or(Value::Null);
        let ctx = CallCtx::begin(caller, request_key(&id));
        let _abandon = ctx.abandon_on_drop();
        let svc = Arc::clone(self);
        let call = async move { svc.run_tool(&ctx, tool, args).await }.in_current_span();
        let outcome = match tokio::spawn(call).await {
            Ok(outcome) => outcome,
            Err(err) => Err(ToolError::internal(format!("{name} task failed: {err}"))),
        };
        rpc_result(
            id,
            match outcome {
                Ok(value) => tool_success(value),
                Err(err) => tool_failure(&err),
            },
        )
    }

    async fn run_tool(&self, ctx: &CallCtx, tool: Tool, args: Value) -> Result<Value, ToolError> {
        let started = Instant::now();
        let outcome = tool.run(self, ctx, args).await;
        let duration_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
        let chat_id = &ctx.caller.chat_id;
        match &outcome {
            Ok(_) => tracing::info!(chat_id, tool = tool.name(), duration_ms, "mcp tool call"),
            Err(err) => tracing::info!(
                chat_id,
                tool = tool.name(),
                code = err.code.as_str(),
                duration_ms,
                "mcp tool call failed"
            ),
        }
        outcome
    }
}

fn on_notification(caller: &Caller, method: &str, params: &Value) {
    if method == "notifications/cancelled"
        && let Some(id) = params.get("requestId")
    {
        caller.calls.cancel(&request_key(id));
    }
}

/// Request ids are numbers or strings; both key the in-flight map as text.
fn request_key(id: &Value) -> String {
    match id {
        Value::String(s) => format!("s:{s}"),
        other => format!("n:{other}"),
    }
}

#[cfg(test)]
#[path = "dispatch_tests.rs"]
mod tests;
