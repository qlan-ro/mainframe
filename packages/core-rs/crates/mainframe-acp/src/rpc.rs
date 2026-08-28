//! JSON-RPC 2.0 framing for the ACP facade connection (todo #350, plan task
//! 7): classify one inbound WS text frame as a request, a notification, or a
//! response to a daemon-initiated call, and build the structured errors a
//! malformed or unroutable frame gets back.
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
    /// A reply to a request the daemon itself sent (e.g. a future
    /// `session/request_permission` answer) — parsed and handed to the
    /// caller; group C has nothing outstanding to match it against yet.
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

pub fn parse_error() -> JsonRpcErrorObject {
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
mod tests {
    use super::*;

    fn fixture(name: &str) -> &'static str {
        match name {
            "jsonrpc-request.initialize" => {
                include_str!(
                    "../../mainframe-types/tests/fixtures/acp/jsonrpc-request.initialize.json"
                )
            }
            "jsonrpc-response.result" => {
                include_str!(
                    "../../mainframe-types/tests/fixtures/acp/jsonrpc-response.result.json"
                )
            }
            "jsonrpc-response.error-unsupported-version" => include_str!(
                "../../mainframe-types/tests/fixtures/acp/jsonrpc-response.error-unsupported-version.json"
            ),
            "jsonrpc-notification.session-update" => include_str!(
                "../../mainframe-types/tests/fixtures/acp/jsonrpc-notification.session-update.json"
            ),
            other => panic!("unknown fixture: {other}"),
        }
    }

    #[test]
    fn classifies_a_request_by_id_key_presence() {
        match parse_frame(fixture("jsonrpc-request.initialize")) {
            Ok(InboundFrame::Request(req)) => {
                assert_eq!(req.method, "initialize");
                assert_eq!(req.id, Some(RequestId::Number(1)));
            }
            other => panic!("expected Request, got {other:?}"),
        }
    }

    #[test]
    fn classifies_a_result_response() {
        match parse_frame(fixture("jsonrpc-response.result")) {
            Ok(InboundFrame::Response(resp)) => {
                assert!(matches!(resp.outcome, JsonRpcOutcome::Result { .. }));
            }
            other => panic!("expected Response, got {other:?}"),
        }
    }

    #[test]
    fn classifies_an_error_response() {
        match parse_frame(fixture("jsonrpc-response.error-unsupported-version")) {
            Ok(InboundFrame::Response(resp)) => {
                assert!(matches!(resp.outcome, JsonRpcOutcome::Error { .. }));
            }
            other => panic!("expected Response, got {other:?}"),
        }
    }

    #[test]
    fn classifies_a_notification_with_no_id_key() {
        match parse_frame(fixture("jsonrpc-notification.session-update")) {
            Ok(InboundFrame::Notification(note)) => {
                assert_eq!(note.method, "session/update");
            }
            other => panic!("expected Notification, got {other:?}"),
        }
    }

    /// The trap the module doc warns about: a request whose `id` is literally
    /// `null` must still be a Request (and later earn a `null`-id reply) —
    /// never conflated with a notification, which has no `id` key at all.
    #[test]
    fn request_with_null_id_is_a_request_not_a_notification() {
        let text = r#"{"jsonrpc":"2.0","id":null,"method":"initialize"}"#;
        match parse_frame(text) {
            Ok(InboundFrame::Request(req)) => assert_eq!(req.id, None),
            other => panic!("expected Request with id: None, got {other:?}"),
        }

        let no_id = r#"{"jsonrpc":"2.0","method":"initialize"}"#;
        match parse_frame(no_id) {
            Ok(InboundFrame::Notification(_)) => {}
            other => panic!("expected Notification, got {other:?}"),
        }
    }

    #[test]
    fn malformed_json_is_a_parse_error() {
        let err = parse_frame("{not json").unwrap_err();
        assert_eq!(err.code, error_codes::PARSE_ERROR);
    }

    #[test]
    fn valid_json_with_no_recognizable_shape_is_an_invalid_request() {
        let err = parse_frame(r#"{"foo":"bar"}"#).unwrap_err();
        assert_eq!(err.code, error_codes::INVALID_REQUEST);
    }

    #[test]
    fn method_not_found_names_the_offending_method() {
        let err = method_not_found("session/prompt");
        assert_eq!(err.code, error_codes::METHOD_NOT_FOUND);
        assert!(err.message.contains("session/prompt"));
    }

    #[test]
    fn success_and_error_responses_serialize_with_the_right_outcome_key() {
        let ok = success_response(Some(RequestId::Number(1)), serde_json::json!({"a": 1}));
        let value = serde_json::to_value(&ok).unwrap();
        assert_eq!(value["result"], serde_json::json!({"a": 1}));
        assert!(value.get("error").is_none());

        let err = error_response(Some(RequestId::Number(1)), method_not_found("x"));
        let value = serde_json::to_value(&err).unwrap();
        assert!(value.get("result").is_none());
        assert_eq!(
            value["error"]["code"],
            serde_json::json!(error_codes::METHOD_NOT_FOUND)
        );
    }
}
