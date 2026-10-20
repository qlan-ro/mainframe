//! JSON-RPC 2.0 framing for the ACP facade connection: classify one inbound WS
//! text frame as a request, a notification, or a response to a daemon-initiated
//! call, and build the structured errors a malformed or unroutable frame gets
//! back.
//!
//! Classification reads the raw `serde_json::Value` first rather than trying
//! `JsonRpcRequest` then falling back to `JsonRpcNotification`: both types
//! deserialize a missing `id` the same way a `null` `id` deserializes
//! (`Option<RequestId>::None`), so a naive try-then-fallback would treat every
//! notification as a request with a `null` id and wrongly send it a reply.
//! The raw object's `id` *key* — present or absent — is what JSON-RPC 2.0
//! actually distinguishes on.

use mainframe_types::acp::jsonrpc::{
    JsonRpcErrorObject, JsonRpcNotification, JsonRpcOutcome, JsonRpcRequest, JsonRpcResponse,
    RequestId, error_codes,
};
use serde_json::Value;

/// One inbound WS text frame, classified per JSON-RPC 2.0 framing.
#[derive(Debug, Clone, PartialEq)]
pub enum InboundFrame {
    Request(JsonRpcRequest),
    Notification(JsonRpcNotification),
    /// A reply to a request the daemon itself sent (a
    /// `session/request_permission` answer) — parsed and handed to the caller;
    /// `mainframe-server`'s `acp_ws` matches it to the pending gate.
    Response(JsonRpcResponse),
}

/// Parse and classify one frame. `Err` carries the structured JSON-RPC error
/// to send back; the caller decides the reply's `id` (usually `null`, since a
/// frame that fails to classify has no trustworthy `id`).
pub fn parse_frame(text: &str) -> Result<InboundFrame, JsonRpcErrorObject> {
    let value: Value = serde_json::from_str(text).map_err(|_| parse_error())?;
    let Value::Object(fields) = &value else {
        return Err(invalid_request());
    };

    if fields.contains_key("method") {
        if fields.contains_key("id") {
            serde_json::from_value::<JsonRpcRequest>(value)
                .map(InboundFrame::Request)
                .map_err(|_| invalid_request())
        } else {
            serde_json::from_value::<JsonRpcNotification>(value)
                .map(InboundFrame::Notification)
                .map_err(|_| invalid_request())
        }
    } else if fields.contains_key("result") || fields.contains_key("error") {
        serde_json::from_value::<JsonRpcResponse>(value)
            .map(InboundFrame::Response)
            .map_err(|_| invalid_request())
    } else {
        Err(invalid_request())
    }
}

pub(crate) fn parse_error() -> JsonRpcErrorObject {
    JsonRpcErrorObject {
        code: error_codes::PARSE_ERROR,
        message: "parse error".into(),
        data: None,
    }
}

pub fn invalid_request() -> JsonRpcErrorObject {
    JsonRpcErrorObject {
        code: error_codes::INVALID_REQUEST,
        message: "invalid request".into(),
        data: None,
    }
}

pub fn method_not_found(method: &str) -> JsonRpcErrorObject {
    JsonRpcErrorObject {
        code: error_codes::METHOD_NOT_FOUND,
        message: format!("method not found: {method}"),
        data: None,
    }
}

pub fn invalid_params(reason: &str) -> JsonRpcErrorObject {
    JsonRpcErrorObject {
        code: error_codes::INVALID_PARAMS,
        message: format!("invalid params: {reason}"),
        data: None,
    }
}

/// The reply a call that failed on the daemon's own side gets. `reason` is a
/// generic phrase, never a panic payload — the detail belongs in the log.
pub fn internal_error(reason: &str) -> JsonRpcErrorObject {
    JsonRpcErrorObject {
        code: error_codes::INTERNAL_ERROR,
        message: format!("internal error: {reason}"),
        data: None,
    }
}

pub fn success_response(id: Option<RequestId>, result: Value) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0".into(),
        id,
        outcome: JsonRpcOutcome::Result { result },
    }
}

pub fn error_response(id: Option<RequestId>, error: JsonRpcErrorObject) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0".into(),
        id,
        outcome: JsonRpcOutcome::Error { error },
    }
}

#[cfg(test)]
#[path = "rpc_tests.rs"]
mod tests;
