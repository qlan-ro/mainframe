use std::collections::HashMap;

use mainframe_types::acp::jsonrpc::RequestId;
use serde_json::{Value, json};

use super::*;

fn fixture(name: &str) -> Value {
    let text = match name {
        "permission.request" => {
            include_str!("../../../mainframe-types/tests/fixtures/acp/permission.request.json")
        }
        "permission.response-plain" => include_str!(
            "../../../mainframe-types/tests/fixtures/acp/permission.response-plain.json"
        ),
        "permission.response-rich" => include_str!(
            "../../../mainframe-types/tests/fixtures/acp/permission.response-rich.json"
        ),
        "permission.response-cancelled" => include_str!(
            "../../../mainframe-types/tests/fixtures/acp/permission.response-cancelled.json"
        ),
        other => panic!("unknown fixture: {other}"),
    };
    serde_json::from_str(text).unwrap()
}

fn control_request() -> ControlRequest {
    ControlRequest {
        request_id: "req_001".into(),
        tool_name: "Bash".into(),
        tool_use_id: "toolu_01A".into(),
        input: HashMap::new(),
        suggestions: Vec::new(),
        decision_reason: None,
    }
}

#[test]
fn build_request_matches_the_pinned_option_vocabulary() {
    let request = build_request(
        "chat_9f2a3b1c",
        RequestId::Str("gate-req_001".into()),
        &control_request(),
    );
    let params = request
        .params
        .expect("session/request_permission needs params");
    let expected = fixture("permission.request");

    assert_eq!(params["sessionId"], expected["sessionId"]);
    assert_eq!(params["options"], expected["options"]);
    assert_eq!(
        params["subject"]["toolCall"]["toolCallId"],
        expected["subject"]["toolCall"]["toolCallId"]
    );
}

#[test]
fn plain_answer_allow_once_maps_to_allow() {
    let response: RequestPermissionResponse =
        serde_json::from_value(fixture("permission.response-plain")).unwrap();
    let control = parse_answer(&control_request(), response).unwrap();

    assert_eq!(control.behavior, ControlBehavior::Allow);
    assert_eq!(control.request_id, "req_001");
    assert_eq!(control.tool_use_id, "toolu_01A");
}

#[test]
fn plain_answer_reject_once_maps_to_deny() {
    let response = RequestPermissionResponse {
        outcome: RequestPermissionOutcome::Selected {
            option_id: OPTION_REJECT_ONCE.to_string(),
        },
        meta: None,
    };
    let control = parse_answer(&control_request(), response).unwrap();
    assert_eq!(control.behavior, ControlBehavior::Deny);
}

#[test]
fn unknown_option_id_is_never_treated_as_approval() {
    let response = RequestPermissionResponse {
        outcome: RequestPermissionOutcome::Selected {
            option_id: "some-future-option".to_string(),
        },
        meta: None,
    };
    let err = parse_answer(&control_request(), response).unwrap_err();
    assert_eq!(
        err,
        GateAnswerError::UnknownOption("some-future-option".to_string())
    );
}

#[test]
fn cancelled_outcome_is_rejected_as_a_session_answer() {
    let response: RequestPermissionResponse =
        serde_json::from_value(fixture("permission.response-cancelled")).unwrap();
    let err = parse_answer(&control_request(), response).unwrap_err();
    assert_eq!(err, GateAnswerError::Cancelled);
}

#[test]
fn rich_answer_carries_todays_control_response_semantics_verbatim() {
    let response: RequestPermissionResponse =
        serde_json::from_value(fixture("permission.response-rich")).unwrap();
    let control = parse_answer(&control_request(), response).unwrap();

    assert_eq!(control.behavior, ControlBehavior::Allow);
    assert_eq!(
        control.updated_input.unwrap().get("command").unwrap(),
        &json!("rm -rf /tmp/scratch --dry-run")
    );
}

#[test]
fn rich_answer_with_a_mismatched_request_id_falls_back_to_the_plain_mapping() {
    let mut fixture = fixture("permission.response-rich");
    fixture["_meta"]["_mainframe.dev"]["controlResponse"]["requestId"] =
        json!("some-other-request");
    let response: RequestPermissionResponse = serde_json::from_value(fixture).unwrap();

    let control = parse_answer(&control_request(), response).unwrap();
    // Falls through to the plain optionId mapping ("allow-once" in the
    // fixture) rather than trusting the mismatched rich answer.
    assert_eq!(control.behavior, ControlBehavior::Allow);
    assert_eq!(
        control.request_id, "req_001",
        "the REAL request's id, not the mismatched rich answer's"
    );
}
