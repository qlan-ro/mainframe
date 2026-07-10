//! Ports `__tests__/request-user-input-routing.test.ts` +
//! `__tests__/request-user-input-resolve.test.ts` assertion-for-assertion.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use std::sync::{Arc, Mutex};

use common::Recorder;
use mainframe_adapter_api::{ControlRequest, ControlResponse};
use mainframe_adapter_codex::approval_handler::{ApprovalHandler, PlanContext, RespondFn};
use mainframe_adapter_codex::event_mapper::CurrentTurnPlan;
use mainframe_adapter_codex::types::RequestId;
use serde_json::{Value, json};

type Calls = Arc<Mutex<Vec<(RequestId, Value)>>>;

fn recording_respond() -> (RespondFn, Calls) {
    let calls: Calls = Arc::new(Mutex::new(Vec::new()));
    let c = calls.clone();
    let respond: RespondFn = Box::new(move |id, v| c.lock().unwrap().push((id, v)));
    (respond, calls)
}

// --- request-user-input-routing.test.ts ---

fn request_user_input_params() -> Value {
    json!({
        "toolCallId": "tc1",
        "questions": ["Implement this plan?"],
        "options": [
            [{ "label": "Yes, implement this plan", "description": "Switch to Default and start coding." }],
            [{ "label": "No, stay in Plan mode", "description": "Continue planning with the model." }],
        ],
    })
}

#[test]
fn routes_to_exit_plan_mode_when_plan_mode_and_plan_captured() {
    let rec = Recorder::new();
    let handler = ApprovalHandler::new(rec.sink());
    handler.set_plan_context(PlanContext {
        plan_mode: true,
        current_turn_plan: Some(CurrentTurnPlan {
            id: "p1".to_string(),
            text: "full plan text".to_string(),
        }),
    });
    let (respond, _) = recording_respond();
    handler.handle_request(
        "item/tool/requestUserInput",
        &request_user_input_params(),
        RequestId::Number(42),
        respond,
    );

    let perms = rec.permissions();
    assert_eq!(perms.len(), 1);
    assert_eq!(perms[0].tool_name, "ExitPlanMode");
    assert_eq!(perms[0].input.get("plan"), Some(&json!("full plan text")));
}

#[test]
fn routes_to_ask_user_question_when_plan_mode_false() {
    let rec = Recorder::new();
    let handler = ApprovalHandler::new(rec.sink());
    handler.set_plan_context(PlanContext {
        plan_mode: false,
        current_turn_plan: Some(CurrentTurnPlan {
            id: "p1".to_string(),
            text: "x".to_string(),
        }),
    });
    let (respond, _) = recording_respond();
    handler.handle_request(
        "item/tool/requestUserInput",
        &request_user_input_params(),
        RequestId::Number(43),
        respond,
    );
    assert_eq!(rec.permissions()[0].tool_name, "AskUserQuestion");
}

#[test]
fn routes_to_ask_user_question_when_no_plan_captured() {
    let rec = Recorder::new();
    let handler = ApprovalHandler::new(rec.sink());
    handler.set_plan_context(PlanContext {
        plan_mode: true,
        current_turn_plan: None,
    });
    let (respond, _) = recording_respond();
    handler.handle_request(
        "item/tool/requestUserInput",
        &request_user_input_params(),
        RequestId::Number(44),
        respond,
    );
    assert_eq!(rec.permissions()[0].tool_name, "AskUserQuestion");
}

// --- request-user-input-resolve.test.ts ---

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

fn resolve(handler: &ApprovalHandler, v: Value) {
    let response: ControlResponse = serde_json::from_value(v).unwrap();
    handler.resolve(&response);
}

fn first_answer(calls: &Calls, qid: &str) -> String {
    let call = &calls.lock().unwrap()[0].1;
    call["answers"][qid]["answers"][0]
        .as_str()
        .unwrap()
        .to_string()
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
    resolve(
        &handler,
        json!({
            "requestId": request.request_id,
            "toolUseId": request.tool_use_id,
            "behavior": "deny",
            "toolName": "AskUserQuestion",
        }),
    );
    assert_eq!(first_answer(&calls, "q5"), "");
}
