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

fn network_params() -> Value {
    json!({"itemId":"i1","threadId":"t1","turnId":"u1","startedAtMs":1,
        "networkApprovalContext":{"host":"example.com","protocol":"https"}})
}

#[test]
fn server_request_resolved_cancels_pending_kinds_without_reply() {
    for (method, params, id) in [
        (
            "item/commandExecution/requestApproval",
            network_params(),
            RequestId::Number(7),
        ),
        (
            "item/tool/requestUserInput",
            request_user_input_params(),
            RequestId::String("7".into()),
        ),
        (
            "item/fileChange/requestApproval",
            json!({"itemId":"file"}),
            RequestId::Number(8),
        ),
    ] {
        let rec = Recorder::new();
        let handler = ApprovalHandler::new(rec.sink());
        let (respond, calls) = recording_respond();
        handler.handle_request(method, &params, id.clone(), respond);
        let request = rec.permissions()[0].clone();
        let notification = json!({"threadId":"other-thread","requestId":id});
        handler.handle_resolved(&notification);
        handler.handle_resolved(&notification);
        assert_eq!(
            rec.0.lock().unwrap().cancellations,
            vec![request.request_id.clone()]
        );
        resolve(
            &handler,
            decision_for(&request, json!({"behavior":"allow"})),
        );
        assert!(calls.lock().unwrap().is_empty());
    }
}

#[test]
fn server_request_resolved_ignores_malformed_unknown_and_answered_ids() {
    let rec = Recorder::new();
    let handler = ApprovalHandler::new(rec.sink());
    let (respond, calls) = recording_respond();
    handler.handle_request(
        "item/commandExecution/requestApproval",
        &network_params(),
        RequestId::Number(7),
        respond,
    );
    for params in [
        json!({}),
        json!({"requestId":null}),
        json!({"requestId":{}}),
        json!({"requestId":true}),
        json!({"requestId":7.5}),
        json!({"requestId":"7"}),
        json!({"requestId":99}),
    ] {
        handler.handle_resolved(&params);
    }
    assert!(rec.0.lock().unwrap().cancellations.is_empty());
    resolve(
        &handler,
        decision_for(&rec.permissions()[0], json!({"behavior":"allow"})),
    );
    handler.handle_resolved(&json!({"requestId":7}));
    assert!(rec.0.lock().unwrap().cancellations.is_empty());
    assert_eq!(calls.lock().unwrap().len(), 1);
}
