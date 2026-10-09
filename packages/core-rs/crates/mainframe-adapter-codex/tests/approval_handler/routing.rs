//! Which Mainframe tool a Codex `requestUserInput` routes to, from
//! `__tests__/request-user-input-routing.test.ts`.

use super::*;

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
fn mcp_elicitations_are_answered_without_a_gate() {
    let rec = Recorder::new();
    let handler = ApprovalHandler::new(rec.sink());
    let (respond, calls) = recording_respond();
    handler.handle_request(
        "mcpServer/elicitation/request",
        &json!({ "serverName": "mainframe", "message": "Allow?" }),
        RequestId::Number(50),
        respond,
    );
    let (respond_other, other_calls) = recording_respond();
    handler.handle_request(
        "mcpServer/elicitation/request",
        &json!({ "serverName": "someone-else" }),
        RequestId::Number(51),
        respond_other,
    );
    assert!(rec.permissions().is_empty());
    assert_eq!(calls.lock().unwrap()[0].1, json!({ "action": "accept" }));
    assert_eq!(
        other_calls.lock().unwrap()[0].1,
        json!({ "action": "decline" })
    );
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
