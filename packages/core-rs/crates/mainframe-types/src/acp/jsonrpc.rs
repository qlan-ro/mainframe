//! JSON-RPC 2.0 envelope (ACP's transport framing). Method-specific params and
//! results (`InitializeRequest`, `ToolCallUpdate`, ...) are typed separately in
//! sibling modules and travel inside `params`/`result` as `serde_json::Value` —
//! the facade connection (group C, out of this task's scope) dispatches on
//! `method` before typing the payload.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// JSON-RPC request id: a number, a string, or (discouraged but legal) `null`.
/// `null` is represented by `Option<RequestId>::None`, which serializes to the
/// wire `null` on the envelope's `id` field without a `skip_serializing_if`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RequestId {
    Number(i64),
    Str(String),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: Option<RequestId>,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JsonRpcNotification {
    pub jsonrpc: String,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

/// The wire type of a JSON-RPC/ACP error `code` — a plain `i32` per the
/// schema's `ErrorCode` (its "Other" arm permits any integer). Named
/// constants below cover the schema's predefined codes plus the one Mainframe
/// adds for unsupported-version negotiation (not an ACP-defined code — see
/// decisions).
pub type ErrorCode = i32;

pub mod error_codes {
    use super::ErrorCode;

    pub const PARSE_ERROR: ErrorCode = -32700;
    pub const INVALID_REQUEST: ErrorCode = -32600;
    pub const METHOD_NOT_FOUND: ErrorCode = -32601;
    pub const INVALID_PARAMS: ErrorCode = -32602;
    pub const INTERNAL_ERROR: ErrorCode = -32603;
    pub const REQUEST_CANCELLED: ErrorCode = -32800;
    pub const AUTHENTICATION_REQUIRED: ErrorCode = -32000;
    pub const RESOURCE_NOT_FOUND: ErrorCode = -32002;
    /// Mainframe-specific: `initialize` requested a `protocolVersion` the
    /// daemon does not support (spec acceptance criterion 1). Reserved-range
    /// (`-32000..-32099`) per the schema's guidance for protocol-specific codes.
    pub const UNSUPPORTED_PROTOCOL_VERSION: ErrorCode = -32001;
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JsonRpcErrorObject {
    pub code: ErrorCode,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

/// The response body: exactly one of `result`/`error`, distinguished by which
/// key is present — the untagged variants try each shape in turn.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum JsonRpcOutcome {
    Result { result: Value },
    Error { error: JsonRpcErrorObject },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: Option<RequestId>,
    #[serde(flatten)]
    pub outcome: JsonRpcOutcome,
}
