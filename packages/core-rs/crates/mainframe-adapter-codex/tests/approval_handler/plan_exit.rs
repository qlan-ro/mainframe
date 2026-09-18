//! Resolving an `ExitPlanMode` gate: which of Codex's own labels the
//! behavior picks, and what a prompt with no usable label answers.

use super::*;

fn plan_exit_params() -> Value {
    json!({
        "toolCallId": "tc1",
        "questions": [{ "id": "q1", "question": "Exit plan mode?" }],
        "options": [
            [{ "label": "Yes, implement this plan", "description": "Switch to Default and start coding." }],
            [{ "label": "No, stay in Plan mode", "description": "Continue planning." }],
        ],
    })
}

fn setup_plan_exit() -> (ApprovalHandler, Calls, ControlRequest) {
    setup_plan_exit_with(plan_exit_params()["options"].clone())
}

/// A plan-exit gate raised with `options` in place of Codex's usual pair.
fn setup_plan_exit_with(options: Value) -> (ApprovalHandler, Calls, ControlRequest) {
    let rec = Recorder::new();
    let handler = ApprovalHandler::new(rec.sink());
    handler.set_plan_context(PlanContext {
        plan_mode: true,
        current_turn_plan: Some(CurrentTurnPlan {
            id: "p1".to_string(),
            text: "PLAN".to_string(),
        }),
    });
    let (respond, calls) = recording_respond();
    handler.handle_request(
        "item/tool/requestUserInput",
        &json!({
            "toolCallId": "tc1",
            "questions": [{ "id": "q1", "question": "Exit plan mode?" }],
            "options": options,
        }),
        RequestId::Number(7),
        respond,
    );
    let request = rec.permissions()[0].clone();
    (handler, calls, request)
}

/// The shipped plan card sends approve and reject with no message at all
/// (`build-control-response.ts`), so the label for the chosen direction is the
/// whole answer — and a blank one is no answer.
fn plan_exit_decision(behavior: &str) -> Value {
    json!({ "behavior": behavior, "toolName": "ExitPlanMode" })
}

#[test]
fn allow_picks_the_yes_label() {
    let (handler, calls, request) = setup_plan_exit();
    resolve(
        &handler,
        json!({
            "requestId": request.request_id,
            "toolUseId": request.tool_use_id,
            "behavior": "allow",
            "toolName": "ExitPlanMode",
            "updatedInput": { "plan": "PLAN" },
        }),
    );
    assert_eq!(calls.lock().unwrap().len(), 1);
    assert_eq!(first_answer(&calls, "q1"), "Yes, implement this plan");
}

#[test]
fn deny_no_message_picks_the_no_label() {
    let (handler, calls, request) = setup_plan_exit();
    resolve(
        &handler,
        json!({
            "requestId": request.request_id,
            "toolUseId": request.tool_use_id,
            "behavior": "deny",
            "toolName": "ExitPlanMode",
        }),
    );
    assert_eq!(first_answer(&calls, "q1"), "No, stay in Plan mode");
}

#[test]
fn deny_with_message_falls_back_to_no_label() {
    let (handler, calls, request) = setup_plan_exit();
    resolve(
        &handler,
        json!({
            "requestId": request.request_id,
            "toolUseId": request.tool_use_id,
            "behavior": "deny",
            "toolName": "ExitPlanMode",
            "message": "Please also add tests.",
        }),
    );
    assert_eq!(first_answer(&calls, "q1"), "No, stay in Plan mode");
}

/// Codex can send a plan-exit prompt whose options carry no labels. The
/// ExitPlanMode branch reads `behavior` to pick between the real "yes"/"no"
/// labels — with no labels to pick, it once fell through to an empty answer
/// string, which Codex takes for a genuine choice.
#[test]
fn plan_exit_without_labels_declines_cleanly() {
    let (handler, calls, request) = setup_plan_exit_with(json!([[{}], [{}]]));
    assert_eq!(request.tool_name, "ExitPlanMode");

    resolve(&handler, decision_for(&request, plan_exit_decision("deny")));

    assert_eq!(calls.lock().unwrap()[0].1, json!({ "answers": {} }));
}

/// An approve whose "yes" label is blank can say nothing Codex would read as
/// approval, so it declines: Codex keeps planning and raises the gate again,
/// where an empty answer string would have been taken for a real choice.
#[test]
fn an_approve_without_a_yes_label_declines_rather_than_answering_blank() {
    let (handler, calls, request) = setup_plan_exit_with(json!([
        [{ "label": "" }],
        [{ "label": "No, keep planning" }],
    ]));

    resolve(
        &handler,
        decision_for(&request, plan_exit_decision("allow")),
    );

    assert_eq!(calls.lock().unwrap()[0].1, json!({ "answers": {} }));
}

/// The same in the other direction: a reject with no "no" label to send.
#[test]
fn a_reject_without_a_no_label_declines_rather_than_answering_blank() {
    let (handler, calls, request) = setup_plan_exit_with(json!([
        [{ "label": "Yes, proceed" }],
        [{ "label": "" }],
    ]));

    resolve(&handler, decision_for(&request, plan_exit_decision("deny")));

    assert_eq!(calls.lock().unwrap()[0].1, json!({ "answers": {} }));
}

/// A revise carries its own text, which stands in for the label the gate
/// never offered.
#[test]
fn a_reject_without_a_no_label_answers_with_the_message() {
    let (handler, calls, request) = setup_plan_exit_with(json!([
        [{ "label": "Yes, proceed" }],
        [{ "label": "" }],
    ]));

    resolve(
        &handler,
        json!({
            "requestId": request.request_id,
            "toolUseId": request.tool_use_id,
            "behavior": "deny",
            "toolName": "ExitPlanMode",
            "message": "Please also add tests.",
        }),
    );

    assert_eq!(first_answer(&calls, "q1"), "Please also add tests.");
}

/// A whitespace-only label is as blank as a missing one, on both the path
/// that offers it and the path that answers with it: Codex reads back the
/// label text, so a nameless button whose answer is blank space is a choice
/// the user never made.
#[test]
fn a_whitespace_only_plan_exit_label_is_neither_offered_nor_answered() {
    let (handler, calls, request) = setup_plan_exit_with(json!([
        [{ "label": "   " }],
        [{ "label": "No, keep planning" }],
    ]));
    let offered = request.options.clone().unwrap_or_default();
    assert_eq!(offered.len(), 1, "{offered:?}");
    assert_eq!(offered[0].option_id, "choice-1");

    resolve(
        &handler,
        decision_for(&request, plan_exit_decision("allow")),
    );

    assert_eq!(calls.lock().unwrap()[0].1, json!({ "answers": {} }));
}
