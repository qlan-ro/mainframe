use std::collections::HashMap;

use mainframe_types::acp::jsonrpc::RequestId;
use serde_json::{Value, json};

use super::*;

mod offered_options_tests;

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
        options: None,
    }
}

/// Desktop-cutover pass: the rich gate cards render the raw `ControlRequest`
/// (input, suggestions), so the request carries it whole under the extension
/// namespace — round-trippable back into the same struct.
#[test]
fn build_request_carries_the_full_control_request_in_meta() {
    let request = build_request(
        "chat_9f2a3b1c",
        RequestId::Str("gate-req_001".into()),
        &control_request(),
    );
    let params = request.params.unwrap();
    let carried: ControlRequest = serde_json::from_value(
        params["_meta"][mainframe_types::acp::extensions::MAINFRAME_META_NAMESPACE]
            ["controlRequest"]
            .clone(),
    )
    .unwrap();
    assert_eq!(carried, control_request());
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

/// The rich gates (plan approval, user questions) have no clicked option to
/// report, so the client falls back to a stand-in id an adapter list never
/// contains. The rich answer stands on its request-id match instead — before
/// this, every Codex plan answer came back `UnknownOption` and the turn hung.
#[test]
fn a_rich_answer_stands_without_an_offered_option_id() {
    let mut request = control_request();
    request.options = Some(vec![PermissionOption {
        option_id: "choice-0".to_string(),
        name: "Approve".to_string(),
        kind: PermissionOptionKind::AllowOnce,
        meta: None,
    }]);
    let mut fixture = fixture("permission.response-rich");
    fixture["outcome"]["optionId"] = json!("allow-once");
    let response: RequestPermissionResponse = serde_json::from_value(fixture).unwrap();

    let control = parse_answer(&request, response).unwrap();

    assert_eq!(control.behavior, ControlBehavior::Allow);
    assert_eq!(control.request_id, "req_001");
}

/// A named option's kind only adds scope or `updatedInput` to a rich answer;
/// it never vetoes the behavior the answer itself carries, which stands on
/// its request-id/tool-use-id match.
#[test]
fn a_rich_answer_outranks_the_kind_of_the_option_it_names() {
    let mut request = control_request();
    request.options = Some(vec![PermissionOption {
        option_id: OPTION_ALLOW_ONCE.to_string(),
        name: "Decline".to_string(),
        kind: PermissionOptionKind::RejectOnce,
        meta: None,
    }]);
    let response: RequestPermissionResponse =
        serde_json::from_value(fixture("permission.response-rich")).unwrap();

    let control = parse_answer(&request, response).unwrap();

    assert_eq!(control.behavior, ControlBehavior::Allow);
    assert_eq!(control.scope, None, "only allow-always overlays a scope");
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

fn control_request_with_suggestions(
    suggestions: Vec<mainframe_types::adapter::ControlUpdate>,
) -> ControlRequest {
    ControlRequest {
        suggestions,
        ..control_request()
    }
}

#[test]
fn an_adapter_supplied_option_carries_its_own_updated_input() {
    let request = ControlRequest {
        options: Some(vec![PermissionOption {
            option_id: "q1-yes".into(),
            name: "Yes".into(),
            kind: PermissionOptionKind::AllowOnce,
            meta: Some(json!({
                mainframe_types::acp::extensions::MAINFRAME_META_NAMESPACE: {
                    "updatedInput": { "answers": ["Yes"] }
                }
            })),
        }]),
        ..control_request()
    };
    let response = RequestPermissionResponse {
        outcome: RequestPermissionOutcome::Selected {
            option_id: "q1-yes".to_string(),
        },
        meta: None,
    };
    let control = parse_answer(&request, response).unwrap();
    assert_eq!(
        control.updated_input.unwrap().get("answers").unwrap(),
        &json!(["Yes"])
    );
}

/// R3.2/T19 regression: the desktop never sets `scope` on a rich answer, so
/// a rich answer selecting an `allow_always` option must still come out
/// session-scoped, or Codex's "Accept for session" re-prompts next turn.
#[test]
fn rich_answer_selecting_an_allow_always_option_gets_session_scope_overlaid() {
    let request = ControlRequest {
        options: Some(vec![PermissionOption {
            option_id: "acceptForSession".into(),
            name: "Accept for session".into(),
            kind: PermissionOptionKind::AllowAlways,
            meta: None,
        }]),
        ..control_request()
    };
    let response = RequestPermissionResponse {
        outcome: RequestPermissionOutcome::Selected {
            option_id: "acceptForSession".to_string(),
        },
        meta: Some(json!({
            "_mainframe.dev": {
                "controlResponse": {
                    "requestId": "req_001",
                    "toolUseId": "toolu_01A",
                    "behavior": "allow"
                }
            }
        })),
    };

    let control = parse_answer(&request, response).unwrap();

    assert_eq!(control.behavior, ControlBehavior::Allow);
    assert_eq!(
        control.scope,
        Some(mainframe_types::adapter::PermissionScope::Session)
    );
}

#[test]
fn allow_always_sets_session_scope() {
    let request =
        control_request_with_suggestions(vec![mainframe_types::adapter::ControlUpdate::SetMode {
            mode: mainframe_types::settings::PermissionMode::AcceptEdits,
            destination: mainframe_types::adapter::ControlDestination::Session,
        }]);
    let response = RequestPermissionResponse {
        outcome: RequestPermissionOutcome::Selected {
            option_id: OPTION_ALLOW_ALWAYS.to_string(),
        },
        meta: None,
    };
    let control = parse_answer(&request, response).unwrap();
    assert_eq!(
        control.scope,
        Some(mainframe_types::adapter::PermissionScope::Session)
    );
}
