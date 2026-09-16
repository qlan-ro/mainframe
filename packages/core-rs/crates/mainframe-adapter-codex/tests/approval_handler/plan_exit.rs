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
        &plan_exit_params(),
        RequestId::Number(7),
        respond,
    );
    let request = rec.permissions()[0].clone();
    (handler, calls, request)
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
/// ExitPlanMode exemption from the clean decline exists because that branch
/// reads `behavior` to pick between the real "yes"/"no" labels — with no
/// labels to pick, it fell through to an empty answer string, which Codex
/// takes for a genuine choice.
#[test]
fn plan_exit_without_labels_declines_cleanly() {
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
            "options": [[{}], [{}]],
        }),
        RequestId::Number(7),
        respond,
    );
    let request = rec.permissions()[0].clone();
    assert_eq!(request.tool_name, "ExitPlanMode");

    resolve(
        &handler,
        json!({
            "requestId": request.request_id,
            "toolUseId": request.tool_use_id,
            "behavior": "deny",
            "toolName": "ExitPlanMode",
        }),
    );

    assert_eq!(calls.lock().unwrap()[0].1, json!({ "answers": {} }));
}

/// A whitespace-only label is as blank as a missing one, on both the path
/// that offers it and the path that answers with it: Codex reads back the
/// label text, so a nameless button whose answer is blank space is a choice
/// the user never made.
#[test]
fn a_whitespace_only_plan_exit_label_is_neither_offered_nor_answered() {
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
            "options": [
                [{ "label": "   " }],
                [{ "label": "No, keep planning" }],
            ],
        }),
        RequestId::Number(7),
        respond,
    );
    let request = rec.permissions()[0].clone();
    let offered = request.options.clone().unwrap_or_default();
    assert_eq!(offered.len(), 1, "{offered:?}");
    assert_eq!(offered[0].option_id, "choice-1");

    resolve(
        &handler,
        json!({
            "requestId": request.request_id,
            "toolUseId": request.tool_use_id,
            "behavior": "allow",
            "toolName": "ExitPlanMode",
            "message": "go",
        }),
    );

    assert_eq!(first_answer(&calls, "q1"), "go");
}
