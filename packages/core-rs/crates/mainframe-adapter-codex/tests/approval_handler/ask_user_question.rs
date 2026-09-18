//! Resolving an `AskUserQuestion` gate: where the answer string comes
//! from, and what a decline sends instead.

use super::*;

fn setup_ask(
    qid: &str,
    question: &str,
    options: Value,
    id: i64,
) -> (ApprovalHandler, Calls, ControlRequest) {
    let rec = Recorder::new();
    let handler = ApprovalHandler::new(rec.sink());
    handler.set_plan_context(PlanContext {
        plan_mode: false,
        current_turn_plan: None,
    });
    let (respond, calls) = recording_respond();
    handler.handle_request(
        "item/tool/requestUserInput",
        &json!({ "toolCallId": "tcx", "questions": [{ "id": qid, "question": question }], "options": options }),
        RequestId::Number(id),
        respond,
    );
    let request = rec.permissions()[0].clone();
    (handler, calls, request)
}

#[test]
fn ask_user_question_keeps_legacy_free_text_message_passthrough() {
    let (handler, calls, request) = setup_ask(
        "q2",
        "Pick one",
        json!([[{ "label": "A" }], [{ "label": "B" }], [{ "label": "C" }]]),
        8,
    );
    resolve(
        &handler,
        json!({
            "requestId": request.request_id,
            "toolUseId": request.tool_use_id,
            "behavior": "allow",
            "toolName": "AskUserQuestion",
            "message": "B",
        }),
    );
    assert_eq!(first_answer(&calls, "q2"), "B");
}

#[test]
fn ask_user_question_extracts_answer_from_updated_input_answers() {
    let (handler, calls, request) = setup_ask(
        "q3",
        "Which approach?",
        json!([[{ "label": "Option A" }], [{ "label": "Option B" }]]),
        9,
    );
    resolve(
        &handler,
        json!({
            "requestId": request.request_id,
            "toolUseId": request.tool_use_id,
            "behavior": "allow",
            "toolName": "AskUserQuestion",
            "updatedInput": { "answers": { "Which approach?": "Option B" } },
        }),
    );
    assert_eq!(first_answer(&calls, "q3"), "Option B");
}

#[test]
fn ask_user_question_handles_array_selection_from_updated_input() {
    let (handler, calls, request) = setup_ask(
        "q4",
        "Select features",
        json!([[{ "label": "Tests" }], [{ "label": "Docs" }], [{ "label": "CI" }]]),
        10,
    );
    resolve(
        &handler,
        json!({
            "requestId": request.request_id,
            "toolUseId": request.tool_use_id,
            "behavior": "allow",
            "toolName": "AskUserQuestion",
            "updatedInput": { "answers": { "Select features": ["Tests", "CI"] } },
        }),
    );
    assert_eq!(first_answer(&calls, "q4"), "Tests");
}

#[test]
fn ask_user_question_falls_back_to_empty_string() {
    let rec = Recorder::new();
    let handler = ApprovalHandler::new(rec.sink());
    handler.set_plan_context(PlanContext {
        plan_mode: false,
        current_turn_plan: None,
    });
    let (respond, calls) = recording_respond();
    handler.handle_request(
        "item/tool/requestUserInput",
        &json!({ "toolCallId": "tc5", "questions": [{ "id": "q5", "question": "Any input?" }] }),
        RequestId::Number(11),
        respond,
    );
    let request = rec.permissions()[0].clone();
    // T19, R3.5: a bare `behavior: "deny"` with no message/updatedInput is
    // now a genuine decline (`reject_on_request_user_input_sends_no_answer`
    // pins that shape) — this test's own case, an allow carrying no real
    // answer data, still falls back to an empty string.
    resolve(
        &handler,
        json!({
            "requestId": request.request_id,
            "toolUseId": request.tool_use_id,
            "behavior": "allow",
            "toolName": "AskUserQuestion",
        }),
    );
    assert_eq!(first_answer(&calls, "q5"), "");
}

#[test]
fn reject_on_request_user_input_sends_no_answer() {
    let (handler, calls, request) = setup_ask(
        "q1",
        "Proceed?",
        json!([[{ "label": "Yes" }], [{ "label": "No" }]]),
        20,
    );
    resolve(
        &handler,
        json!({
            "requestId": request.request_id,
            "toolUseId": request.tool_use_id,
            "behavior": "deny",
            "toolName": "AskUserQuestion",
        }),
    );
    assert_eq!(calls.lock().unwrap()[0].1, json!({ "answers": {} }));
}

#[test]
fn a_plain_option_answer_selects_a_real_question_choice() {
    let (handler, calls, request) = setup_ask(
        "q1",
        "Proceed?",
        json!([[{ "label": "Yes" }], [{ "label": "No" }]]),
        21,
    );
    let options = request
        .options
        .as_ref()
        .expect("requestUserInput must carry adapter-supplied options");
    let yes = options
        .iter()
        .find(|o| o.name == "Yes")
        .expect("a Yes option for the offered choice");
    let updated_input = yes
        .meta
        .as_ref()
        .and_then(|m| m.get("_mainframe.dev"))
        .and_then(|ns| ns.get("updatedInput"))
        .cloned()
        .expect("the Yes option must carry its own updatedInput answer");

    // Mirrors what `gates::parse_answer` (mainframe-acp) does for a plain
    // `{outcome:"selected", optionId}` answer: map the option's own kind to
    // a behavior and copy its meta's updatedInput onto the response.
    resolve(
        &handler,
        json!({
            "requestId": request.request_id,
            "toolUseId": request.tool_use_id,
            "behavior": "allow",
            "toolName": "AskUserQuestion",
            "updatedInput": updated_input,
        }),
    );
    assert_eq!(
        calls.lock().unwrap()[0].1,
        json!({ "answers": { "q1": { "answers": ["Yes"] } } })
    );
}
