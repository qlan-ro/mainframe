//! Per-frame ACP facade dispatch (todo #350, plan task 8): a pure function
//! from one WS text frame to the reply (if any) to write back. Parameterized
//! on `DaemonInfo` rather than reading any daemon state directly, so this
//! stays unit-testable without a socket — `mainframe-server`'s `acp_ws`
//! module is the thin axum shell that owns the socket loop and heartbeat
//! ticker (task 9) and calls `handle_frame` once per inbound frame.

use mainframe_types::acp::extensions::MAINFRAME_META_NAMESPACE;
use mainframe_types::acp::jsonrpc::{
    JsonRpcErrorObject, JsonRpcRequest, JsonRpcResponse, RequestId, error_codes,
};
use mainframe_types::acp::session::{
    Implementation, InitializeRequest, InitializeResponse, PINNED_PROTOCOL_VERSION,
};
use serde_json::{Value, json};

use crate::capabilities::mainframe_capabilities;
use crate::rpc::{self, InboundFrame};

/// The daemon identity and configured heartbeat cadence threaded in from
/// `AppCtx` — the only state `initialize`'s response needs.
pub struct DaemonInfo {
    pub version: String,
    pub heartbeat_interval_ms: u64,
}

/// Handle one inbound WS text frame. `Some` is the JSON to write back;
/// notifications and daemon-initiated-request responses never get one, per
/// JSON-RPC 2.0 (even when the notification names an unknown method — a
/// notification's sender does not expect an answer to be listening for).
pub fn handle_frame(text: &str, daemon: &DaemonInfo) -> Option<String> {
    match rpc::parse_frame(text) {
        Ok(InboundFrame::Request(request)) => Some(to_wire(&dispatch_request(request, daemon))),
        Ok(InboundFrame::Notification(_)) => None,
        Ok(InboundFrame::Response(_)) => None,
        Err(error) => Some(to_wire(&rpc::error_response(None, error))),
    }
}

fn dispatch_request(request: JsonRpcRequest, daemon: &DaemonInfo) -> JsonRpcResponse {
    match request.method.as_str() {
        "initialize" => handle_initialize(request.id, request.params, daemon),
        other => rpc::error_response(request.id, rpc::method_not_found(other)),
    }
}

/// Negotiate the pinned protocol version and advertise `_mainframe.dev`
/// capabilities. An unsupported `protocolVersion` gets the structured
/// `UNSUPPORTED_PROTOCOL_VERSION` error — the connection stays open; only the
/// caller's socket loop decides whether to close, and this function never
/// does.
fn handle_initialize(
    id: Option<RequestId>,
    params: Option<Value>,
    daemon: &DaemonInfo,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return rpc::error_response(id, rpc::invalid_params("initialize requires params"));
    };
    let request: InitializeRequest = match serde_json::from_value(params) {
        Ok(request) => request,
        Err(err) => return rpc::error_response(id, rpc::invalid_params(&err.to_string())),
    };
    if request.protocol_version != PINNED_PROTOCOL_VERSION {
        return rpc::error_response(id, unsupported_protocol_version());
    }

    let response = InitializeResponse {
        protocol_version: PINNED_PROTOCOL_VERSION,
        info: Implementation {
            name: "mainframe-daemon".into(),
            title: None,
            version: daemon.version.clone(),
        },
        capabilities: Some(json!({ "session": {} })),
        auth_methods: None,
        meta: Some(json!({
            MAINFRAME_META_NAMESPACE: mainframe_capabilities(daemon.heartbeat_interval_ms),
        })),
    };
    let result = serde_json::to_value(response).unwrap_or(Value::Null);
    rpc::success_response(id, result)
}

/// Mainframe-specific: not an ACP-defined code (see `error_codes` doc comment
/// in `mainframe_types::acp::jsonrpc`), reserved-range per the schema's
/// protocol-specific-code guidance. `data.supported` lists every protocol
/// version this daemon negotiates — today, just the one pinned snapshot.
fn unsupported_protocol_version() -> JsonRpcErrorObject {
    JsonRpcErrorObject {
        code: error_codes::UNSUPPORTED_PROTOCOL_VERSION,
        message: "unsupported protocol version".into(),
        data: Some(json!({ "supported": [PINNED_PROTOCOL_VERSION] })),
    }
}

fn to_wire(response: &JsonRpcResponse) -> String {
    serde_json::to_string(response).unwrap_or_else(|_| {
        r#"{"jsonrpc":"2.0","id":null,"error":{"code":-32603,"message":"internal error"}}"#.into()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn daemon() -> DaemonInfo {
        DaemonInfo {
            version: "1.0.0".into(),
            heartbeat_interval_ms: 15_000,
        }
    }

    #[test]
    fn initialize_at_the_pinned_version_returns_a_result_with_capabilities_meta() {
        let text = include_str!(
            "../../mainframe-types/tests/fixtures/acp/jsonrpc-request.initialize.json"
        );
        let reply = handle_frame(text, &daemon()).expect("initialize must reply");
        let value: Value = serde_json::from_str(&reply).unwrap();

        assert_eq!(value["id"], json!(1));
        assert_eq!(
            value["result"]["protocolVersion"],
            json!(PINNED_PROTOCOL_VERSION)
        );
        assert_eq!(value["result"]["info"]["name"], json!("mainframe-daemon"));
        assert_eq!(
            value["result"]["_meta"]["_mainframe.dev"]["heartbeatIntervalMs"],
            json!(15_000)
        );
    }

    #[test]
    fn unsupported_version_gets_the_structured_error_and_a_still_open_connection() {
        let text = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":99,"info":{"name":"x","version":"1"}}}"#;
        let reply = handle_frame(text, &daemon()).expect("initialize must reply");
        let value: Value = serde_json::from_str(&reply).unwrap();

        assert_eq!(
            value["error"]["code"],
            json!(error_codes::UNSUPPORTED_PROTOCOL_VERSION)
        );
        assert_eq!(
            value["error"]["data"]["supported"],
            json!([PINNED_PROTOCOL_VERSION])
        );

        // The connection stays open: a second, valid frame on the same
        // (simulated) socket still gets a proper reply.
        let ok = r#"{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":2,"info":{"name":"x","version":"1"}}}"#;
        let second = handle_frame(ok, &daemon()).expect("a later frame must still be handled");
        let second_value: Value = serde_json::from_str(&second).unwrap();
        assert!(second_value.get("result").is_some());
    }

    #[test]
    fn unknown_method_request_gets_method_not_found() {
        let text = r#"{"jsonrpc":"2.0","id":1,"method":"session/prompt","params":{}}"#;
        let reply = handle_frame(text, &daemon()).unwrap();
        let value: Value = serde_json::from_str(&reply).unwrap();
        assert_eq!(value["error"]["code"], json!(error_codes::METHOD_NOT_FOUND));
    }

    #[test]
    fn unadvertised_notification_gets_no_reply() {
        let text = r#"{"jsonrpc":"2.0","method":"session/update","params":{}}"#;
        assert_eq!(handle_frame(text, &daemon()), None);
    }

    #[test]
    fn malformed_frame_gets_a_null_id_error_and_the_loop_can_continue() {
        let reply = handle_frame("{not json", &daemon()).expect("malformed frame must reply");
        let value: Value = serde_json::from_str(&reply).unwrap();
        assert_eq!(value["id"], Value::Null);
        assert_eq!(value["error"]["code"], json!(error_codes::PARSE_ERROR));
    }
}
