use super::*;

fn fixture(name: &str) -> &'static str {
    match name {
        "jsonrpc-request.initialize" => {
            include_str!("../../mainframe-types/tests/fixtures/acp/jsonrpc-request.initialize.json")
        }
        "jsonrpc-response.result" => {
            include_str!("../../mainframe-types/tests/fixtures/acp/jsonrpc-response.result.json")
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
