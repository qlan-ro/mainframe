//! Method dispatch for one authenticated JSON-RPC message.

use std::time::Instant;

use serde_json::{Value, json};

use mainframe_types::acp::jsonrpc::error_codes;

use crate::credentials::Caller;
use crate::errors::{tool_failure, tool_success};
use crate::protocol::{Incoming, RpcReply, classify, initialize_result, rpc_error, rpc_result};
use crate::service::OrchestrationService;
use crate::tools;

impl OrchestrationService {
    /// Handles one POST body from an authenticated caller.
    pub async fn handle(&self, caller: &Caller, body: &[u8]) -> RpcReply {
        match classify(body) {
            Err(reply) => reply,
            Ok(Incoming::Response) => RpcReply::Accepted,
            Ok(Incoming::Notification { method, params }) => {
                self.on_notification(caller, &method, &params);
                RpcReply::Accepted
            }
            Ok(Incoming::Request { id, method, params }) => {
                RpcReply::Response(self.on_request(caller, id, &method, params).await)
            }
        }
    }

    fn on_notification(&self, caller: &Caller, method: &str, params: &Value) {
        if method == "notifications/cancelled"
            && let Some(request_id) = params.get("requestId").map(request_key)
        {
            self.cancel_call(caller, &request_id);
        }
    }

    async fn on_request(&self, caller: &Caller, id: Value, method: &str, params: Value) -> Value {
        match method {
            "initialize" => rpc_result(id, initialize_result(&params, self.version())),
            "ping" => rpc_result(id, json!({})),
            "tools/list" => rpc_result(id, json!({ "tools": tools::list() })),
            "tools/call" => self.on_tools_call(caller, id, params).await,
            _ => rpc_error(id, error_codes::METHOD_NOT_FOUND, "Method not found"),
        }
    }

    async fn on_tools_call(&self, caller: &Caller, id: Value, params: Value) -> Value {
        let Some(name) = params.get("name").and_then(Value::as_str) else {
            return rpc_error(
                id,
                error_codes::INVALID_PARAMS,
                "tools/call needs a tool name",
            );
        };
        if !tools::exists(name) {
            return rpc_error(
                id,
                error_codes::INVALID_PARAMS,
                &format!("Unknown tool: {name}"),
            );
        }
        let args = params.get("arguments").cloned().unwrap_or(Value::Null);
        let request_id = request_key(&id);
        let ctx = self.begin_call(caller, &request_id);
        let started = Instant::now();
        let outcome = tools::call(self, &ctx, name, args).await;
        self.end_call(caller, &request_id);
        let duration_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
        let result = match outcome {
            Ok(value) => {
                tracing::info!(
                    chat_id = caller.chat_id,
                    tool = name,
                    duration_ms,
                    "mcp tool call"
                );
                tool_success(value)
            }
            Err(err) => {
                tracing::info!(
                    chat_id = caller.chat_id,
                    tool = name,
                    code = err.code.as_str(),
                    duration_ms,
                    "mcp tool call failed"
                );
                tool_failure(&err)
            }
        };
        rpc_result(id, result)
    }
}

/// Request ids are numbers or strings; both key the in-flight map as text.
fn request_key(id: &Value) -> String {
    match id {
        Value::String(s) => format!("s:{s}"),
        other => format!("n:{other}"),
    }
}
