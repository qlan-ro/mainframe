//! What the daemon offers on a gate: Claude's derived triad, an adapter's own
//! list, and the empty list that is neither.
//! Answer-parsing cases live in the parent module; both share its fixtures.

use super::*;

#[test]
fn build_request_matches_the_pinned_option_vocabulary() {
    let request = build_request(
        "chat_9f2a3b1c",
        RequestId::String("gate-req_001".into()),
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
        format!(
            "tool:{}",
            expected["subject"]["toolCall"]["toolCallId"]
                .as_str()
                .unwrap()
        )
    );
}

/// An adapter that sends an empty list has offered nothing, not "no options"
/// — but the gate still must not become approvable by an id the adapter never
/// named. Codex's `requestUserInput` with empty labels is the live producer:
/// a plain `allow-once` against it resolves to an empty answer string Codex
/// takes for a real choice.
#[test]
fn an_empty_adapter_option_list_offers_only_the_reject_option() {
    let mut request = control_request();
    request.options = Some(Vec::new());

    let built = build_request(
        "chat_9f2a3b1c",
        RequestId::String("gate-req_001".into()),
        &request,
    );
    let params = built
        .params
        .expect("session/request_permission needs params");
    let offered: Vec<&str> = params["options"]
        .as_array()
        .expect("an options array")
        .iter()
        .map(|option| option["optionId"].as_str().expect("an option id"))
        .collect();

    assert_eq!(offered, vec![OPTION_REJECT_ONCE]);
}

#[test]
fn a_plain_allow_against_an_empty_adapter_list_is_an_unknown_option() {
    let mut request = control_request();
    request.options = Some(Vec::new());
    let response = RequestPermissionResponse {
        outcome: RequestPermissionOutcome::Selected {
            option_id: OPTION_ALLOW_ONCE.to_string(),
        },
        meta: None,
    };

    let err = parse_answer(&request, response).unwrap_err();

    assert_eq!(
        err,
        GateAnswerError::UnknownOption(OPTION_ALLOW_ONCE.to_string())
    );
}

#[test]
fn claude_hides_allow_always_without_suggestions() {
    let no_suggestions = build_request(
        "chat_1",
        RequestId::String("gate-req_001".into()),
        &control_request(),
    );
    let ids: Vec<String> = no_suggestions.params.unwrap()["options"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o["optionId"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(ids, vec!["allow-once", "reject-once"]);

    let with_suggestion = build_request(
        "chat_1",
        RequestId::String("gate-req_001".into()),
        &control_request_with_suggestions(vec![mainframe_types::adapter::ControlUpdate::SetMode {
            mode: mainframe_types::settings::PermissionMode::AcceptEdits,
            destination: mainframe_types::adapter::ControlDestination::Session,
        }]),
    );
    let ids: Vec<String> = with_suggestion.params.unwrap()["options"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o["optionId"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(ids, vec!["allow-once", "allow-always", "reject-once"]);
}

#[test]
fn claude_hides_allow_always_when_nothing_suggested_may_be_saved() {
    let suggestions: Vec<mainframe_types::adapter::ControlUpdate> = serde_json::from_value(json!([
        { "type": "setMode", "mode": "yolo", "destination": "session" },
        { "type": "setMode", "mode": "bypassPermissions", "destination": "session" },
        { "type": "someday" }
    ]))
    .unwrap();
    let request = control_request_with_suggestions(suggestions);

    let ids: Vec<String> = offered_options(&request)
        .into_iter()
        .map(|option| option.option_id)
        .collect();

    assert_eq!(ids, vec!["allow-once", "reject-once"]);
}

/// An older client sends every suggestion back. The answer still resolves its
/// gate; the chat layer is what takes the unsavable part out.
#[test]
fn a_rich_answer_with_an_update_it_cannot_read_still_parses() {
    let response: RequestPermissionResponse = serde_json::from_value(json!({
        "outcome": { "outcome": "selected", "optionId": "allow-always" },
        "_meta": { "_mainframe.dev": { "controlResponse": {
            "requestId": "req_001",
            "toolUseId": "toolu_01A",
            "behavior": "allow",
            "updatedPermissions": [
                { "type": "setMode", "mode": "bypassPermissions", "destination": "session" }
            ]
        } } }
    }))
    .unwrap();

    let mut control = parse_answer(&control_request(), response).unwrap();

    assert_eq!(control.behavior, ControlBehavior::Allow);
    assert_eq!(control.withhold_ungrantable().len(), 1);
    assert_eq!(control.updated_permissions, Some(vec![]));
}
